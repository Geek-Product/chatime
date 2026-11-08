import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inArray } from 'drizzle-orm';
import { env } from '../../env';
import { db } from '../db/index';
import { attachments } from '../db/schema';

export const MAX_FILE_BYTES = env.UPLOAD_MAX_MB * 1024 * 1024;
/** Overall multipart body cap: a bit above the per-file limit so the file check reports the real error. */
export const MAX_UPLOAD_BYTES = MAX_FILE_BYTES + 256 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);
const EXT_BY_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/zip': '.zip',
  'application/octet-stream': '.bin',
};

/**
 * Files we hand back with their declared type. Anything else is served as an opaque download so a
 * crafted `.html`/`.svg` upload can never run script on our origin.
 */
export const INLINE_TYPES = new Set([...IMAGE_TYPES, 'application/pdf']);

export const attachmentDir = () => path.resolve(import.meta.dirname, '../../', env.UPLOAD_DIR);

/** Headers every attachment response gets: only our own inline types, never sniffed. */
export const safeHeaders = (mimeType: string) =>
  INLINE_TYPES.has(mimeType)
    ? { 'content-type': mimeType, 'x-content-type-options': 'nosniff' }
    : {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment',
        'x-content-type-options': 'nosniff',
      };

export function originalFilename(raw: string | undefined) {
  const base = (raw ?? 'file')
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f<>:"|?*]/g, '')
    .trim();
  return (base || 'file').slice(0, 200);
}

export function sniffImageMime(type: string, data: Buffer): string | null {
  if (type === 'image/jpeg' && data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (type === 'image/png' && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (type === 'image/gif' && data.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (type === 'image/webp' && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (type === 'image/avif' && data.subarray(4, 8).toString('latin1') === 'ftyp') return 'image/avif';
  if (type === 'image/bmp' && data[0] === 0x42 && data[1] === 0x4d) return 'image/bmp';
  return null;
}

/** Reads width/height from PNG, GIF or JPEG headers (null for other formats). */
export function imageSize(data: Buffer): { width: number; height: number } | null {
  if (data.length > 24 && data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length > 10 && data.subarray(0, 3).toString('latin1') === 'GIF') {
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) return null;
      const marker = data[i + 1];
      const len = data.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

export async function saveUpload(opts: {
  userId: string;
  filename: string;
  declaredType: string;
  data: Buffer;
}) {
  const isImage = IMAGE_TYPES.has(opts.declaredType);
  const mimeType = isImage ? sniffImageMime(opts.declaredType, opts.data) : opts.declaredType;
  if (isImage && !mimeType) return { error: `"${opts.filename}" does not look like a valid image` as const };

  const ext = EXT_BY_TYPE[mimeType ?? opts.declaredType] ?? '.bin';
  const key = `${opts.userId}/${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
  const full = path.join(attachmentDir(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, opts.data);

  const dims = isImage ? imageSize(opts.data) : null;
  const [row] = await db
    .insert(attachments)
    .values({
      uploaderId: opts.userId,
      filename: opts.filename,
      mimeType: mimeType ?? opts.declaredType,
      storageKey: key,
      size: opts.data.length,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
    })
    .returning();
  return { attachment: row };
}

export type AttachmentDto = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  isImage: boolean;
};

export const toAttachmentDto = (a: typeof attachments.$inferSelect): AttachmentDto => ({
  id: a.id,
  filename: a.filename,
  mimeType: a.mimeType,
  size: a.size,
  width: a.width,
  height: a.height,
  url: `/api/attachments/${a.id}`,
  isImage: INLINE_TYPES.has(a.mimeType) && a.mimeType.startsWith('image/'),
});

export async function attachmentsForMessages(messageIds: string[]) {
  if (messageIds.length === 0) return [];
  return db.select().from(attachments).where(inArray(attachments.messageId, messageIds));
}

export function readAttachment(key: string) {
  return createReadStream(path.join(attachmentDir(), key));
}

export async function deleteStoredFiles(keys: string[]) {
  await Promise.all(keys.map((k) => rm(path.join(attachmentDir(), k), { force: true }).catch(() => {})));
}
