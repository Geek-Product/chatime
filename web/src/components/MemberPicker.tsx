import { useMemo, useState } from 'react';
import { Hash, Search } from 'lucide-react';
import { Avatar } from './Avatar';
import type { ChannelPerson } from '../lib/types';

/** Searchable member checklist used by the channel create/edit dialogs. */
export function MemberPicker({
  people,
  selected,
  onToggle,
  excludedIds,
  online,
}: {
  people: ChannelPerson[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Members that can't be picked (e.g. people already in the channel). */
  excludedIds?: ReadonlySet<string>;
  online?: ReadonlySet<string>;
}) {
  const [query, setQuery] = useState('');
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    return people
      .filter((p) => !excludedIds?.has(p.id))
      .filter((p) => !q || p.displayName.toLowerCase().includes(q) || p.username.toLowerCase().includes(q));
  }, [people, query, excludedIds]);

  return (
    <div className="rounded-md border border-zinc-300 bg-white">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search size={14} className="text-zinc-500" />
        <input
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-zinc-400"
          placeholder="Search people by name or @username"
          aria-label="Search people to invite"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="max-h-40 overflow-y-auto py-1" role="group" aria-label="People to invite">
        {candidates.length === 0 && (
          <p className="px-3 py-3 text-xs text-zinc-500">{people.length === 0 ? 'No other members in this workspace.' : 'Nobody matches that search.'}</p>
        )}
        {candidates.map((p) => {
          const checked = selected.has(p.id);
          return (
            <label
              key={p.id}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-hover"
            >
              <input type="checkbox" checked={checked} onChange={() => onToggle(p.id)} aria-label={`Invite ${p.displayName}`} />
              <Avatar name={p.displayName} color={p.avatarColor} size={22} online={online?.has(p.id)} />
              <span className="truncate font-semibold">{p.displayName}</span>
              <span className="truncate text-xs text-zinc-500">@{p.username}</span>
            </label>
          );
        })}
      </div>
      <div className="border-t border-line px-3 py-1.5 text-[11px] font-semibold text-zinc-600">
        {selected.size === 0 ? (
          'Nobody selected'
        ) : (
          <span className="flex items-center gap-1">
            <Hash size={11} /> {selected.size} selected
          </span>
        )}
      </div>
    </div>
  );
}
