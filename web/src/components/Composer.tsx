import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bold,
  Code,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Paperclip,
  Quote,
  Strikethrough,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, uploadAttachment } from '../lib/api';
import type { Attachment, Member } from '../lib/types';
import { toggleInline, toggleLinePrefix } from './MessageText';
import { formatBytes, keepPreview } from './AttachmentView';

const MAX = 8000;
const MAX_FILES = 10;

type Format = { marker: string; label: string; Icon: typeof Bold } | { prefix: string; label: string; Icon: typeof Bold };

const FORMATS: Format[] = [
  { marker: '**', label: 'Bold (Ctrl+B)', Icon: Bold },
  { marker: '_', label: 'Italic (Ctrl+I)', Icon: Italic },
  { marker: '~~', label: 'Strikethrough', Icon: Strikethrough },
  { marker: '`', label: 'Inline code (Ctrl+E)', Icon: Code },
  { prefix: '> ', label: 'Quote', Icon: Quote },
  { prefix: '- ', label: 'Bulleted list', Icon: List },
  { prefix: '1. ', label: 'Numbered list', Icon: ListOrdered },
];

interface Staged {
  key: string;
  file: File;
  preview: string | null;
  progress: number;
  failed: boolean;
  attachment: Attachment | null;
}

export function Composer({
  placeholder,
  members,
  autoFocus,
  onSend,
}: {
  placeholder: string;
  members: Member[];
  autoFocus?: boolean;
  onSend: (content: string, attachmentIds: string[]) => Promise<void>;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const [limits, setLimits] = useState<{ mb: number; max: number } | null>(null);
  const [mention, setMention] = useState<{ query: string; start: number; index: number } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const uploading = staged.some((s) => !s.attachment && !s.failed);
  const ready = staged.filter((s) => s.attachment);
  const canSend = (value.trim().length > 0 || ready.length > 0) && !sending && !uploading;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    void api
      .get<{ maxFileMb: number; maxFiles: number }>('/attachments/limits')
      .then((l) => setLimits({ mb: l.maxFileMb, max: l.maxFiles }))
      .catch(() => setLimits(null));
  }, []);

  useEffect(() => {
    // Local previews only live while their file is staged; drop them when the composer unmounts.
    return () => {
      for (const s of stagedRef.current) if (s.preview) URL.revokeObjectURL(s.preview);
    };
  }, []);
  const stagedRef = useRef<Staged[]>([]);
  stagedRef.current = staged;

  const candidates = mention
    ? members
        .filter((m) => m.username.toLowerCase().startsWith(mention.query.toLowerCase()))
        .slice(0, 6)
    : [];

  function updateMentionState(text: string, caret: number) {
    const before = text.slice(0, caret);
    const m = before.match(/(^|\s)@([a-zA-Z0-9_.-]{0,32})$/);
    if (m) setMention({ query: m[2], start: caret - m[2].length - 1, index: 0 });
    else setMention(null);
  }

  function pickMention(username: string) {
    if (!mention) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const next = `${value.slice(0, mention.start)}@${username} ${value.slice(caret)}`;
    setValue(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + username.length + 2;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  function apply(format: Format) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const result = 'marker' in format
      ? toggleInline(value, start, end, format.marker)
      : toggleLinePrefix(value, start, format.prefix);
    setValue(result.value);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.start, result.end);
    });
  }

  function addFiles(files: File[]) {
    const maxMb = limits?.mb ?? 25;
    const maxFiles = limits?.max ?? MAX_FILES;
    const room = Math.max(0, maxFiles - stagedRef.current.length);
    const accepted = files.filter((f) => {
      if (f.size > maxMb * 1024 * 1024) {
        toast.error(`${f.name} is larger than ${maxMb} MB`);
        return false;
      }
      if (f.size === 0) {
        toast.error(`${f.name} is empty`);
        return false;
      }
      return true;
    });
    if (accepted.length > room) toast.error(`You can attach up to ${maxFiles} files per message`);
    const batch = accepted.slice(0, room);
    if (!batch.length) return;

    const items: Staged[] = batch.map((file) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      preview: file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(file.name) ? URL.createObjectURL(file) : null,
      progress: 0,
      failed: false,
      attachment: null,
    }));
    setStaged((prev) => [...prev, ...items]);

    for (const item of items) {
      uploadAttachment(item.file, (p) =>
        setStaged((prev) => prev.map((s) => (s.key === item.key ? { ...s, progress: p } : s))),
      )
        .then((attachment) => {
          if (item.preview) keepPreview(qc, attachment.url, item.preview);
          setStaged((prev) => prev.map((s) => (s.key === item.key ? { ...s, progress: 1, attachment } : s)));
        })
        .catch((e: Error) => {
          setStaged((prev) => prev.map((s) => (s.key === item.key ? { ...s, failed: true } : s)));
          toast.error(`${item.file.name}: ${e.message}`);
        });
    }
  }

  function removeStaged(key: string) {
    const item = stagedRef.current.find((s) => s.key === key);
    setStaged((prev) => prev.filter((s) => s.key !== key));
    // Free server-side space for uploads that will never be sent.
    if (item?.attachment) void api.del(`/attachments/${item.attachment.id}`).catch(() => {});
  }

  async function send() {
    if (!canSend) return;
    const content = value.trim();
    const attachmentIds = ready.map((s) => s.attachment!.id);
    setSending(true);
    setValue('');
    setMention(null);
    try {
      await onSend(content, attachmentIds);
      setStaged([]);
    } catch {
      setValue((cur) => (cur.trim() ? cur : content));
    } finally {
      setSending(false);
    }
  }

  return (
    <div data-testid="composer" className="relative px-5 pb-6">
      {candidates.length > 0 && (
        <div className="absolute bottom-full left-5 z-20 mb-1 w-72 overflow-hidden rounded-lg border border-line bg-white shadow-xl">
          <div className="border-b border-line px-3 py-1.5 text-xs font-bold tracking-wide text-zinc-500 uppercase">
            People
          </div>
          {candidates.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(m.username);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === mention?.index ? 'bg-purple-50' : 'hover:bg-hover'}`}
            >
              <span className="h-5 w-5 rounded" style={{ background: m.avatarColor }} />
              <span className="font-semibold">{m.username}</span>
              <span className="truncate text-zinc-500">{m.displayName}</span>
            </button>
          ))}
        </div>
      )}

      <div
        className={`rounded-lg border bg-white focus-within:shadow-sm ${dragging ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-zinc-300 focus-within:border-zinc-500'}`}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {staged.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-line px-3 py-2">
            {staged.map((s) => (
              <StagedChip key={s.key} item={s} onRemove={() => removeStaged(s.key)} />
            ))}
          </div>
        )}

        <div className="flex items-center gap-0.5 border-b border-line px-1.5 py-1" role="toolbar" aria-label="Formatting">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Attach files"
            aria-label="Attach files"
            className="rounded p-1.5 text-zinc-500 hover:bg-hover hover:text-ink"
          >
            <Paperclip size={15} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <span className="mx-1 h-4 w-px bg-line" />
          {FORMATS.map((f) => (
            <button
              key={f.label}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                apply(f);
              }}
              title={f.label}
              aria-label={f.label}
              className="rounded p-1.5 text-zinc-500 hover:bg-hover hover:text-ink"
            >
              <f.Icon size={15} />
            </button>
          ))}
          <span className="ml-auto pr-1 text-[11px] text-zinc-400">
            <b>Enter</b> send · <b>Shift+Enter</b> new line · <b>@</b> mention · **bold** _italic_ {'```'} code
          </span>
        </div>
        <textarea
          ref={ref}
          rows={1}
          value={value}
          maxLength={MAX}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            updateMentionState(e.target.value, e.target.selectionStart);
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onClick={(e) => updateMentionState(value, e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (mention && candidates.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                setMention({ ...mention, index: (mention.index + delta + candidates.length) % candidates.length });
                return;
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault();
                pickMention(candidates[mention.index].username);
                return;
              }
              if (e.key === 'Escape') {
                setMention(null);
                return;
              }
            }
            if ((e.ctrlKey || e.metaKey) && !e.altKey) {
              const key = e.key.toLowerCase();
              const shortcut = key === 'b' ? FORMATS[0] : key === 'i' ? FORMATS[1] : key === 'e' ? FORMATS[3] : null;
              if (shortcut) {
                e.preventDefault();
                apply(shortcut);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="block max-h-[200px] w-full resize-none bg-transparent px-3 pt-2.5 pb-2 text-[15px] outline-none placeholder:text-zinc-400"
          aria-label="Message"
        />
        <div className="flex items-center justify-between px-2 pb-1.5">
          <span className="pl-1 text-[11px] text-zinc-400">
            {dragging ? 'Drop files to attach' : `Attach up to ${limits?.max ?? MAX_FILES} files · max ${limits?.mb ?? 25} MB · paste or drop`}
          </span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function StagedChip({ item, onRemove }: { item: Staged; onRemove: () => void }) {
  return (
    <div className="relative flex items-center gap-2 rounded-md border border-line bg-panel py-1 pr-6 pl-2">
      {item.preview ? (
        <img src={item.preview} alt={item.file.name} className="h-9 w-9 rounded object-cover" />
      ) : (
        <Paperclip size={16} className="text-zinc-500" />
      )}
      <div className="max-w-40">
        <div className="truncate text-xs font-semibold text-ink" title={item.file.name}>
          {item.file.name}
        </div>
        <div className={`text-[11px] ${item.failed ? 'text-red-600' : 'text-zinc-500'}`}>
          {item.failed ? 'Upload failed' : item.attachment ? formatBytes(item.attachment.size) : `${Math.round(item.progress * 100)}%`}
        </div>
      </div>
      {!item.attachment && !item.failed && (
        <span className="absolute bottom-0 left-0 h-0.5 bg-emerald-500 transition-all" style={{ width: `${item.progress * 100}%` }} />
      )}
      {!item.attachment && !item.failed && (
        <Loader2 size={14} className="animate-spin text-zinc-400" />
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.file.name}`}
        className="absolute top-0.5 right-0.5 rounded p-0.5 text-zinc-400 hover:bg-hover hover:text-ink"
      >
        <X size={12} />
      </button>
    </div>
  );
}
