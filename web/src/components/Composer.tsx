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

/** A list item the caret is sitting on: `next` is what Enter inserts to continue the list. */
interface ListItem {
  /** Offset of the first character after the marker (`- `, `1. `). */
  contentStart: number;
  end: number;
  body: string;
  marker: string;
  next: string;
}

const LIST_MARKER = /^(\s{0,3})(?:([-*+])|([0-9]{1,9})([.)]))[ \t]+/;
/** A marker the user just typed, before the trailing space (e.g. `1.`). */
const BARE_MARKER = /^(\s{0,3})([-*+]|[0-9]{1,9}[.)])$/;

/** The list item containing `caret`, if the caret is after its marker. */
function listItemAt(value: string, caret: number): ListItem | null {
  const start = value.lastIndexOf('\n', caret - 1) + 1;
  const nl = value.indexOf('\n', start);
  const end = nl === -1 ? value.length : nl;
  const line = value.slice(start, end);
  const m = LIST_MARKER.exec(line);
  if (!m) return null;
  const contentStart = start + m[0].length;
  if (caret < contentStart || caret > end) return null;
  const [marker, indent, bullet, number, delimiter] = m;
  const next = bullet ? `${indent}${bullet} ` : `${indent}${Number(number) + 1}${delimiter} `;
  return { contentStart, end, body: line.slice(marker.length), marker, next };
}

export function Composer({
  placeholder,
  members,
  autoFocus,
  lastOwnMessage,
  onSend,
  onEdit,
  compact,
}: {
  placeholder: string;
  members: Member[];
  autoFocus?: boolean;
  /** The user's most recent message here, recalled with ↑ in an empty composer to be edited. */
  lastOwnMessage?: { id: string; content: string } | null;
  onSend: (content: string, attachmentIds: string[]) => Promise<void>;
  /** Saves an edited message; Enter then updates it instead of posting a new one. */
  onEdit?: (id: string, content: string) => Promise<void>;
  /** Narrower layouts (the thread panel) drop the keyboard-shortcut hint above the textarea. */
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const [limits, setLimits] = useState<{ mb: number; max: number } | null>(null);
  const [mention, setMention] = useState<{ query: string; start: number; index: number } | null>(null);
  /** Set while the composer holds a recalled message; Enter saves it instead of sending. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const uploading = staged.some((s) => !s.attachment && !s.failed);
  const ready = staged.filter((s) => s.attachment);
  const canSubmit = editingId ? value.trim().length > 0 && !sending : (value.trim().length > 0 || ready.length > 0) && !sending && !uploading;

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

  /**
   * Replaces `[start, end)` in the textarea's live value (not the last rendered state) and puts the
   * caret after the insert, so typing that arrives before React re-renders is never lost.
   */
  function replaceRange(start: number, end: number, insert: string) {
    const el = ref.current!;
    const caret = start + insert.length;
    const next = el.value.slice(0, start) + insert + el.value.slice(end);
    el.value = next;
    el.setSelectionRange(caret, caret);
    setValue(next);
    setMention(null);
  }

  /** Enter continues a list; on an empty item it drops the marker and ends the list. */
  function continueList(item: ListItem, caret: number) {
    if (item.body.trim()) {
      replaceRange(caret, caret, `\n${item.next}`);
      return;
    }
    // The caret sits inside the marker, so the whole line goes. The next Enter then sends.
    const lineStart = item.contentStart - item.marker.length;
    const atLineEnd = item.end === ref.current!.value.length;
    replaceRange(atLineEnd && lineStart > 0 ? lineStart - 1 : lineStart, item.end, '');
  }

  /** ↑ in an empty composer recalls the last message for editing, caret at the end. */
  function recallLast() {
    if (!lastOwnMessage || stagedRef.current.length > 0 || !onEdit) return;
    setEditingId(lastOwnMessage.id);
    replaceRange(0, ref.current!.value.length, lastOwnMessage.content);
  }

  /** Leaving the recalled message (Escape, or text cleared) returns Enter to sending. */
  function stopEditing() {
    setEditingId(null);
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
    if (editingId && onEdit) return saveEdit();
    if (!canSubmit) return;
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

  /** Enter over a recalled message saves it in place; blank text cancels the edit. */
  async function saveEdit() {
    if (!editingId || !onEdit) return;
    const content = value.trim();
    if (!content) {
      stopEditing();
      setValue('');
      return;
    }
    setSending(true);
    try {
      await onEdit(editingId, content);
      setValue('');
      setMention(null);
      setEditingId(null);
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
          {!compact && (
            <span className="ml-auto pr-1 text-[11px] text-zinc-400">
              <b>Enter</b> {editingId ? 'save' : 'send'} · <b>Shift+Enter</b> new line · <b>↑</b> edit last · **bold** _italic_ {'```'} code
            </span>
          )}
        </div>
        <textarea
          ref={ref}
          rows={1}
          value={value}
          maxLength={MAX}
          placeholder={placeholder}
          onChange={(e) => {
            // A list opens on the space that follows `-`/`*`/`1.` typed at a line start.
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
            const el = e.currentTarget;
            // While editing a recalled message, Escape drops the edit back to a normal composer.
            if (editingId && e.key === 'Escape') {
              e.preventDefault();
              stopEditing();
              setValue('');
              return;
            }
            // `-`/`*`/`1.` at a line start + space opens a list. keydown runs before the space is
            // inserted, so we place the marker and its space ourselves and swallow this keystroke.
            if (e.key === ' ') {
              const caret = el.selectionStart;
              const lineStart = el.value.lastIndexOf('\n', caret - 1) + 1;
              const bare = BARE_MARKER.exec(el.value.slice(lineStart, caret));
              const nextChar = el.value[caret];
              if (bare && (nextChar === undefined || nextChar === '\n') && el.selectionEnd === caret) {
                e.preventDefault();
                replaceRange(lineStart, caret, `${bare[1]}${bare[2]} `);
                return;
              }
            }
            // ↑ only recalls into a truly empty composer; while a popup is open it navigates instead.
            if (e.key === 'ArrowUp' && value === '' && el.selectionStart === 0 && !mention) {
              e.preventDefault();
              recallLast();
              return;
            }
            if ((e.ctrlKey || e.metaKey) && !e.altKey) {
              const key = e.key.toLowerCase();
              if (key === 'enter') {
                e.preventDefault();
                void send();
                return;
              }
              const shortcut = key === 'b' ? FORMATS[0] : key === 'i' ? FORMATS[1] : key === 'e' ? FORMATS[3] : null;
              if (shortcut) {
                e.preventDefault();
                apply(shortcut);
                return;
              }
            }
            // Enter continues a list; on an empty item it exits the list (the next Enter sends).
            if (e.key === 'Enter' && !e.shiftKey && !editingId) {
              const item = listItemAt(el.value, el.selectionStart);
              if (item) {
                e.preventDefault();
                continueList(item, el.selectionStart);
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
            {editingId
              ? 'Editing your last message · Enter save · Esc cancel'
              : dragging ? 'Drop files to attach' : `Attach up to ${limits?.max ?? MAX_FILES} files · max ${limits?.mb ?? 25} MB · paste or drop`}
          </span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSubmit}
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
          >
            {editingId ? 'Save' : 'Send'}
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
