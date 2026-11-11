import { useState } from 'react';
import { Download, FileCode2, FileSpreadsheet, FileText, File as FileIcon, Maximize2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAccessToken, downloadAttachment } from '../lib/api';
import { languageForFile, languageLabel } from '../lib/codeHighlight';
import { toast } from 'sonner';
import type { Attachment } from '../lib/types';
import { CodePreview } from './CodePreview';

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Object URLs for authenticated images; the access token never ends up in a plain <img src>. */
export function useAttachmentBlob(url: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['attachment-blob', url],
    queryFn: async () => {
      const res = await fetch(`/api${url.replace(/^\/api/, '')}`, {
        headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
      });
      if (!res.ok) throw new Error('Could not load image');
      return URL.createObjectURL(await res.blob());
    },
    initialData: () => qc.getQueryData<string>(['attachment-preview', url]),
    staleTime: 30 * 60_000,
    gcTime: 0,
  });
}

/** Reuses a just-uploaded local preview for the server URL so the sent message renders without a refetch. */
export function keepPreview(qc: ReturnType<typeof useQueryClient>, serverUrl: string, localUrl: string) {
  qc.setQueryData(['attachment-preview', serverUrl], localUrl);
}

function fileIcon(mime: string) {
  if (mime === 'application/pdf' || mime.startsWith('text/')) return FileText;
  if (mime.includes('csv') || mime.includes('spreadsheet') || mime.includes('excel')) return FileSpreadsheet;
  return FileIcon;
}

/** Code files keep their extension (uploads are stored as `.bin`), so the client decides by filename. */
const isCodeFile = (a: Attachment) => !a.isImage && languageForFile(a.filename) !== null;

function ImageAttachment({ attachment }: { attachment: Attachment }) {
  const { data: src, isError } = useAttachmentBlob(attachment.url);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 16 / 9;

  if (isError || failed) {
    return (
      <div className="flex h-24 w-64 items-center justify-center rounded-lg border border-line bg-panel text-xs text-zinc-500">
        Image unavailable
      </div>
    );
  }

  return (
    <>
      {src ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group relative block overflow-hidden rounded-lg border border-line bg-panel"
          title={attachment.filename}
        >
          <img
            src={src}
            alt={attachment.filename}
            onError={() => setFailed(true)}
            className="max-h-72 max-w-full rounded-lg object-contain"
            style={{ aspectRatio: ratio > 0 ? ratio : 16 / 9, minWidth: 120 }}
          />
          <span className="absolute right-2 bottom-2 hidden rounded bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white group-hover:block">
            {attachment.filename} · {formatBytes(attachment.size)}
          </span>
        </button>
      ) : (
        <div className="h-40 w-64 animate-pulse rounded-lg border border-line bg-panel" aria-label="Loading image" />
      )}

      {open && src && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-6"
          onMouseDown={() => setOpen(false)}
        >
          <img
            src={src}
            alt={attachment.filename}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] max-w-full rounded shadow-2xl"
          />
          <div className="mt-3 flex items-center gap-4 text-sm text-white/80" onMouseDown={(e) => e.stopPropagation()}>
            <span>{attachment.filename}</span>
            <button
              type="button"
              className="flex items-center gap-1 rounded border border-white/30 px-2 py-0.5 hover:bg-white/10"
              onClick={() => void downloadAttachment(attachment.url, attachment.filename)}
            >
              <Download size={14} /> Download
            </button>
            <button type="button" className="rounded border border-white/30 px-2 py-0.5 hover:bg-white/10" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function FileAttachment({ attachment }: { attachment: Attachment }) {
  const code = isCodeFile(attachment);
  const lang = code ? languageForFile(attachment.filename) : null;
  const [previewing, setPreviewing] = useState(false);
  const Icon = code ? FileCode2 : fileIcon(attachment.mimeType);

  return (
    <>
      <button
        type="button"
        onClick={() =>
          code
            ? setPreviewing(true)
            : void downloadAttachment(attachment.url, attachment.filename).catch((e: Error) => toast.error(e.message))
        }
        className="flex max-w-sm items-center gap-2.5 rounded-lg border border-line bg-white px-3 py-2 text-left hover:border-zinc-400 hover:bg-hover"
        title={code ? `Preview ${attachment.filename}` : `Download ${attachment.filename}`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-purple-50 text-accent">
          <Icon size={18} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-ink">{attachment.filename}</span>
          <span className="block text-xs text-zinc-500">
            {formatBytes(attachment.size)}
            {lang && <> · {languageLabel(lang)}</>}
          </span>
        </span>
        {code
          ? <Maximize2 size={14} className="ml-2 shrink-0 text-zinc-400" />
          : <Download size={15} className="ml-2 shrink-0 text-zinc-400" />}
      </button>
      {previewing && <CodePreview attachment={attachment} onClose={() => setPreviewing(false)} />}
    </>
  );
}

export function Attachments({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null;
  const images = attachments.filter((a) => a.isImage);
  const files = attachments.filter((a) => !a.isImage);
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {images.length > 0 && (
        <div className="flex max-w-2xl flex-wrap gap-2">
          {images.map((a) => <ImageAttachment key={a.id} attachment={a} />)}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((a) => <FileAttachment key={a.id} attachment={a} />)}
        </div>
      )}
    </div>
  );
}
