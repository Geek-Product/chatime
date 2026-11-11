import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Download, Loader2, WrapText, X } from 'lucide-react';
import { toast } from 'sonner';
import { downloadAttachment, fetchAttachmentText } from '../lib/api';
import { escapeHtml, languageForFile, languageLabel, useHighlighter } from '../lib/codeHighlight';
import type { Attachment } from '../lib/types';
import { formatBytes } from './AttachmentView';

export function CodePreview({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const lang = languageForFile(attachment.filename);
  const highlight = useHighlighter();
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['attachment-text', attachment.url],
    queryFn: () => fetchAttachmentText(attachment.url),
    staleTime: 30 * 60_000,
    gcTime: 0,
    retry: false,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const html = useMemo(
    () => (data === undefined ? '' : highlight?.(data, lang) ?? escapeHtml(data.replace(/\n$/, ''))),
    [data, lang, highlight],
  );
  const lineCount = useMemo(() => (data ? data.replace(/\n$/, '').split('\n').length : 0), [data]);

  function copy() {
    if (data === undefined) return;
    void navigator.clipboard.writeText(data).then(
      () => setCopied(true),
      () => toast.error('Could not copy to clipboard'),
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${attachment.filename}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8"
      onMouseDown={onClose}
    >
      <div
        className="flex h-full max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <span className="flex h-6 min-w-6 items-center justify-center rounded bg-purple-50 px-1.5 text-[10px] font-bold text-accent">
            {languageLabel(lang) ?? 'FILE'}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-ink" title={attachment.filename}>{attachment.filename}</div>
            <div className="text-[11px] text-zinc-500">
              {formatBytes(attachment.size)}
              {data !== undefined && <> · {lineCount} {lineCount === 1 ? 'line' : 'lines'}</>}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={copy}
              disabled={data === undefined}
              title="Copy contents"
              aria-label="Copy contents"
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-zinc-600 hover:bg-hover disabled:opacity-40"
            >
              {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => setWrap((v) => !v)}
              title={wrap ? 'Disable line wrap' : 'Wrap long lines'}
              aria-label="Toggle line wrap"
              aria-pressed={wrap}
              className={`rounded p-1.5 hover:bg-hover ${wrap ? 'text-accent' : 'text-zinc-600'}`}
            >
              <WrapText size={16} />
            </button>
            <button
              type="button"
              onClick={() => void downloadAttachment(attachment.url, attachment.filename).catch((e: Error) => toast.error(e.message))}
              title="Download"
              aria-label="Download"
              className="rounded p-1.5 text-zinc-600 hover:bg-hover"
            >
              <Download size={16} />
            </button>
            <span className="mx-1 h-5 w-px bg-line" />
            <button type="button" onClick={onClose} title="Close" aria-label="Close preview" className="rounded p-1.5 text-zinc-600 hover:bg-hover">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-[#fbfbfc]">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          )}
          {isError && (
            <div className="px-6 py-16 text-center text-sm text-zinc-500">
              {(error as Error)?.message ?? 'Could not load file'}
            </div>
          )}
          {data !== undefined && lineCount > 0 && (
            <div className="code-preview flex min-w-full text-[12.5px]">
              <div aria-hidden className="sticky left-0 z-10 shrink-0 select-none border-r border-line bg-[#f4f4f6] px-3 py-3 text-right font-mono text-zinc-400">
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i} className="leading-5">{i + 1}</div>
                ))}
              </div>
              <pre
                className={`flex-1 px-4 py-3 font-mono leading-5 ${wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
                // Prism escapes the source before wrapping it in <span> tokens.
                dangerouslySetInnerHTML={{ __html: `<code class="language-${lang ?? 'text'}">${html}</code>` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
