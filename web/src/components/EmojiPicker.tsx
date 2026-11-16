import { useMemo, useState } from 'react';
import { Film, Loader2, Search, Smile, Sticker, X } from 'lucide-react';
import { toast } from 'sonner';
import { EMOJI_CATEGORIES } from '../lib/emoji';

const RECENTS_KEY = 'tc.emojiRecents';
const MAX_RECENTS = 22;

const STICKERS = ['party', 'thumbsup', 'heart', 'laugh', 'fire', 'rocket', 'thanks', 'hundred', 'cool', 'hug', 'check', 'celebrate'];
const GIFS = ['party', 'thumbsup', 'fire', 'rocket', 'heart', 'laugh', 'wow', 'clap'];

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

type Tab = 'emoji' | 'stickers' | 'gifs';

const TABS: { id: Tab; label: string; Icon: typeof Smile }[] = [
  { id: 'emoji', label: 'Emoji', Icon: Smile },
  { id: 'stickers', label: 'Stickers', Icon: Sticker },
  { id: 'gifs', label: 'GIFs', Icon: Film },
];

/** Emoji, sticker and GIF popover for the message composer. */
export function EmojiPicker({
  onPickEmoji,
  onSendMedia,
  onClose,
}: {
  onPickEmoji: (emoji: string) => void;
  /** Uploads the asset at `url` and posts it as its own message. */
  onSendMedia: (url: string, label: string) => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('emoji');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('smileys');
  const [recents, setRecents] = useState<string[]>(readRecents);
  const [pending, setPending] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return EMOJI_CATEGORIES.flatMap((c) => c.items).filter((e) => e.name.includes(q) || e.char === q);
  }, [query]);
  const current = EMOJI_CATEGORIES.find((c) => c.id === category) ?? EMOJI_CATEGORIES[0];
  const emojiItems = matches ?? (category === 'recents' ? recents.map((char) => ({ char, name: char })) : current.items);

  function pick(emoji: string) {
    onPickEmoji(emoji);
    const next = [emoji, ...recents.filter((e) => e !== emoji)].slice(0, MAX_RECENTS);
    setRecents(next);
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  }

  async function send(url: string, label: string) {
    if (pending) return;
    setPending(url);
    try {
      await onSendMedia(url, label);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Emoji, stickers and GIFs"
      className="flex w-[336px] flex-col overflow-hidden rounded-xl border border-line bg-white shadow-2xl"
    >
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-bold ${
              tab === id ? 'bg-accent-soft text-accent' : 'text-zinc-500 hover:bg-hover hover:text-ink'
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close picker"
          className="ml-auto rounded p-1 text-zinc-400 hover:bg-hover hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>

      {tab === 'emoji' && (
        <>
          <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
            <Search size={13} className="text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search emoji"
              className="w-full bg-transparent text-xs outline-none placeholder:text-zinc-400"
              aria-label="Search emoji"
            />
          </div>
          {!query && (
            <div className="flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
              {recents.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCategory('recents')}
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${
                    category === 'recents' ? 'bg-accent text-white' : 'text-zinc-500 hover:bg-hover'
                  }`}
                >
                  Recent
                </button>
              )}
              {EMOJI_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${
                    category === c.id ? 'bg-accent text-white' : 'text-zinc-500 hover:bg-hover'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <div className="grid h-56 grid-cols-8 content-start gap-0.5 overflow-y-auto p-1.5">
            {emojiItems.map((e, i) => (
              <button
                key={`${e.char}-${i}`}
                type="button"
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => pick(e.char)}
                title={e.name}
                aria-label={e.name}
                className="rounded p-1 text-xl leading-none hover:bg-hover"
              >
                {e.char}
              </button>
            ))}
            {emojiItems.length === 0 && (
              <p className="col-span-8 py-8 text-center text-xs text-zinc-500">No emoji match “{query.trim()}”.</p>
            )}
          </div>
        </>
      )}

      {tab === 'stickers' && (
        <div className="grid h-64 grid-cols-3 content-start gap-2 overflow-y-auto p-2">
          {STICKERS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => void send(`/stickers/${name}.png`, `sticker-${name}`)}
              disabled={pending !== null}
              title={`Send ${name} sticker`}
              aria-label={`Send ${name} sticker`}
              className="relative aspect-square rounded-lg border border-transparent p-1 hover:border-line hover:bg-panel disabled:opacity-60"
            >
              <img src={`/stickers/${name}.png`} alt="" loading="lazy" draggable={false} className="h-full w-full object-contain" />
              {pending === `/stickers/${name}.png` && (
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/70">
                  <Loader2 size={18} className="animate-spin text-zinc-500" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {tab === 'gifs' && (
        <div className="grid h-64 grid-cols-2 content-start gap-2 overflow-y-auto p-2">
          {GIFS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => void send(`/gifs/${name}.gif`, `gif-${name}`)}
              disabled={pending !== null}
              title={`Send ${name} GIF`}
              aria-label={`Send ${name} GIF`}
              className="relative aspect-square rounded-lg border border-transparent p-1 hover:border-line hover:bg-panel disabled:opacity-60"
            >
              <img src={`/gifs/${name}.gif`} alt="" loading="lazy" draggable={false} className="h-full w-full rounded object-cover" />
              {pending === `/gifs/${name}.gif` && (
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/70">
                  <Loader2 size={18} className="animate-spin text-zinc-500" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
