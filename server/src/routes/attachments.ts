import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { eq } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { db } from '../db/index';
import { attachments, messages } from '../db/schema';
import { getChannelForUser, getConversationForUser } from '../lib/access';
import {
  INLINE_TYPES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_MESSAGE,
  MAX_UPLOAD_BYTES,
  originalFilename,
  readAttachment,
  safeHeaders,
  saveUpload,
  sniffImageMime,
  toAttachmentDto,
} from '../lib/attachments';
import { authenticate, ACCESS_TOKEN_TTL_SECONDS, requireUser, verifyAccessToken } from '../lib/auth';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors';

const tooLarge = () => new HttpError(413, 'FILE_TOO_LARGE', `Files must be at most ${MAX_FILE_BYTES / 1024 / 1024} MB`);

/** The user behind an attachment request: `Authorization` header or `?token=` (images in <img> tags). */
async function viewerOf(req: { headers: Record<string, unknown>; query: unknown }) {
  const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (header.startsWith('Bearer ')) return verifyAccessToken(header.slice(7));
  const { token } = z.object({ token: z.string().optional() }).parse(req.query ?? {});
  return token ? verifyAccessToken(token) : null;
}

export default async function attachmentRoutes(app: FastifyInstance) {
  app.get('/attachments/limits', { preHandler: authenticate }, async () => ({
    maxFileMb: Math.floor(MAX_FILE_BYTES / 1024 / 1024),
    maxFiles: MAX_FILES_PER_MESSAGE,
  }));

  app.post('/attachments', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const me = requireUser(req);
    if (!req.isMultipart()) throw badRequest('Send the file as multipart/form-data with field "file"');
    let file: MultipartFile | undefined;
    try {
      file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    } catch (e) {
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge();
      throw e;
    }
    if (!file) throw badRequest('No file uploaded');
    const data = await file.toBuffer().catch((e: { code?: string }) => {
      if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_FILES_LIMIT') throw tooLarge();
      throw e;
    });
    if (data.length === 0) throw badRequest('The file is empty');
    if (file.file.truncated || data.length > MAX_FILE_BYTES) throw tooLarge();
    const declaredType = (file.mimetype || 'application/octet-stream').toLowerCase();
    if (declaredType.startsWith('image/') && !sniffImageMime(declaredType, data)) {
      throw badRequest(`"${originalFilename(file.filename)}" is not a valid image`);
    }
    const saved = await saveUpload({
      userId: me.id,
      filename: originalFilename(file.filename),
      declaredType,
      data,
    });
    if ('error' in saved && saved.error) throw badRequest(saved.error);
    if (!('attachment' in saved) || !saved.attachment) throw badRequest('Upload failed');
    return reply.code(201).send({ attachment: toAttachmentDto(saved.attachment) });
  });

  app.get('/attachments/:attachmentId', async (req, reply) => {
    const userId = await viewerOf(req);
    if (!userId) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Sign in to view this file' } });
    const { attachmentId } = z.object({ attachmentId: z.string().uuid() }).parse(req.params);
    const { download } = z.object({ download: z.string().optional() }).parse(req.query ?? {});
    const [a] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
    if (!a) throw notFound('Attachment not found');

    // Only people who can see the message may fetch its files.
    if (a.messageId) {
      const [msg] = await db
        .select({ channelId: messages.channelId, directConversationId: messages.directConversationId })
        .from(messages)
        .where(eq(messages.id, a.messageId));
      if (!msg) throw notFound('Attachment not found');
      if (msg.directConversationId) await getConversationForUser(msg.directConversationId, userId);
      else await getChannelForUser(msg.channelId!, userId);
    }

    const headers: Record<string, string> = { 'cache-control': 'private, max-age=3600' };
    Object.assign(headers, safeHeaders(a.mimeType));
    // Images stay inline (thumbnails); `?download=1` and non-inline types force a save dialog.
    if (download || !INLINE_TYPES.has(a.mimeType)) {
      headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`;
    }
    return reply
      .headers({ ...headers, 'content-length': String(a.size) })
      .send(readAttachment(a.storageKey) as unknown as Readable);
  });

  app.delete('/attachments/:attachmentId', { preHandler: authenticate }, async (req) => {
    const me = requireUser(req);
    const { attachmentId } = z.object({ attachmentId: z.string().uuid() }).parse(req.params);
    const [a] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
    if (!a) throw notFound('Attachment not found');
    if (a.uploaderId !== me.id) throw forbidden('You can only remove your own files');
    await db.delete(attachments).where(eq(attachments.id, attachmentId));
    return { ok: true };
  });
}
