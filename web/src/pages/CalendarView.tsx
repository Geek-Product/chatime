import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Avatar } from '../components/Avatar';
import { api } from '../lib/api';
import type { OfficeAbsence } from '../lib/types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n: number) => String(n).padStart(2, '0');
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d: Date, n: number) => {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
};
const monthLabel = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const dayLabel = (key: string) =>
  parseKey(key).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const shortDay = (key: string) => parseKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const rangeLabel = (a: Pick<OfficeAbsence, 'startDate' | 'endDate'>) =>
  a.startDate === a.endDate ? shortDay(a.startDate) : `${shortDay(a.startDate)} – ${shortDay(a.endDate)}`;
const covers = (a: Pick<OfficeAbsence, 'startDate' | 'endDate'>, key: string) => a.startDate <= key && a.endDate >= key;

function MarkOutDialog({ workspaceId, initialDate, onClose }: { workspaceId: string; initialDate: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [startDate, setStartDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialDate);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = useMutation({
    mutationFn: () => api.post<{ absence: { id: string } }>(`/workspaces/${workspaceId}/absences`, {
      startDate,
      endDate,
      note: note.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['absences', workspaceId] });
      toast.success('Marked as out of office');
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!startDate || !endDate) return setError('Pick both dates');
    if (endDate < startDate) return setError('The end date must be on or after the start date');
    create.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Mark time out of office"
        className="w-full max-w-md rounded-xl border border-zinc-300 bg-white p-6 text-ink shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-ink">Out of office</h2>
            <p className="mt-1 text-sm text-zinc-600">Everyone in the workspace will see these days on the team calendar.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-600 hover:bg-hover hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-sm font-bold text-ink">
            First day
            <input
              type="date"
              value={startDate}
              required
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
              className="mt-1 w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <label className="block text-sm font-bold text-ink">
            Last day
            <input
              type="date"
              value={endDate}
              required
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </label>
        </div>

        <label className="mt-3 block text-sm font-bold text-ink">
          Note (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={160}
            placeholder="e.g. Working from home, annual leave"
            className="mt-1 w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-zinc-400 focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>

        {error && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}

        <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={onClose} className="rounded-md border border-zinc-400 bg-white px-4 py-2 text-sm font-bold text-ink hover:bg-hover">
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {create.isPending ? 'Saving…' : 'Save absence'}
          </button>
        </div>
      </form>
    </div>
  );
}

function AbsenceRow({
  absence,
  meId,
  canRemove,
  onRemove,
  showRange = true,
}: {
  absence: OfficeAbsence;
  meId: string;
  canRemove: boolean;
  onRemove: (id: string) => void;
  showRange?: boolean;
}) {
  return (
    <li className="flex items-start gap-2 py-2">
      <Avatar name={absence.displayName} color={absence.avatarColor} photo={absence.avatarUrl} size={28} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">
          {absence.displayName}
          {absence.userId === meId && <span className="ml-1 text-[11px] font-semibold text-zinc-400">you</span>}
          {absence.title && <span className="ml-1.5 text-[11px] font-semibold text-zinc-400">{absence.title}</span>}
        </p>
        <p className="text-[11px] font-semibold text-zinc-500">{showRange ? rangeLabel(absence) : `@${absence.username}`}</p>
        {absence.note && <p className="mt-0.5 text-xs text-zinc-600">{absence.note}</p>}
      </div>
      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(absence.id)}
          title="Remove this absence"
          aria-label={`Remove absence for ${absence.displayName}`}
          className="rounded p-1 text-zinc-400 hover:bg-hover hover:text-red-600"
        >
          <Trash2 size={13} />
        </button>
      )}
    </li>
  );
}

export default function CalendarView({ workspaceId, meId, isAdmin = false }: { workspaceId: string; meId: string; isAdmin?: boolean }) {
  const qc = useQueryClient();
  const todayKey = toKey(new Date());
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState(todayKey);
  const [showMarkOut, setShowMarkOut] = useState(false);

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Monday-first grid
    const start = addDays(first, -offset);
    const gridDays = offset + new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells = Math.ceil(gridDays / 7) * 7;
    return Array.from({ length: cells }, (_, i) => addDays(start, i));
  }, [cursor]);
  const from = toKey(days[0]);
  const to = toKey(days[days.length - 1]);

  const { data, isLoading } = useQuery({
    queryKey: ['absences', workspaceId, from, to],
    queryFn: () => api.get<{ absences: OfficeAbsence[] }>(`/workspaces/${workspaceId}/absences?from=${from}&to=${to}`),
  });
  const absences = useMemo(() => data?.absences ?? [], [data]);
  const onDay = (key: string) => absences.filter((a) => covers(a, key));
  const todayAbsent = onDay(todayKey);
  const selectedAbsences = onDay(selected);
  const upcoming = useMemo(
    () => [...absences].filter((a) => a.endDate >= todayKey).sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [absences, todayKey],
  );

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/workspaces/${workspaceId}/absences/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['absences', workspaceId] });
      toast.success('Absence removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const shiftMonth = (months: number) => {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + months, 1);
    setCursor(next);
    setSelected(toKey(next));
  };
  const goToday = () => {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelected(todayKey);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-panel">
      <div className="border-b border-line bg-white px-8 pt-10 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <CalendarDays size={22} /> Team calendar
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Days teammates are away from the office. Visible to everyone in this workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowMarkOut(true)}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-bold text-white hover:bg-accent-hover"
          >
            <Plus size={15} /> Mark me out
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-8 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-4 py-3">
          <span className="text-[11px] font-bold tracking-wide text-zinc-500 uppercase">Out today</span>
          {todayAbsent.length === 0 ? (
            <span className="text-sm text-zinc-500">Everyone is in the office.</span>
          ) : (
            todayAbsent.map((a) => (
              <span key={a.id} className="flex items-center gap-1.5 rounded-full bg-amber-50 py-0.5 pr-2.5 pl-0.5 text-xs font-bold text-amber-900">
                <Avatar name={a.displayName} color={a.avatarColor} photo={a.avatarUrl} size={18} />
                {a.displayName}
              </span>
            ))
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-xl border border-line bg-white">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <h2 className="text-sm font-bold text-ink">{monthLabel(cursor)}</h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  aria-label="Previous month"
                  className="rounded p-1 text-zinc-600 hover:bg-hover hover:text-ink"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={goToday}
                  className="rounded-md border border-zinc-400 bg-white px-2 py-1 text-xs font-bold text-ink hover:bg-hover"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  aria-label="Next month"
                  className="rounded p-1 text-zinc-600 hover:bg-hover hover:text-ink"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-px bg-line/70">
              {WEEKDAYS.map((w) => (
                <div key={w} className="bg-panel px-2 py-1.5 text-center text-[11px] font-bold tracking-wide text-zinc-500 uppercase">
                  {w}
                </div>
              ))}
              {days.map((d) => {
                const key = toKey(d);
                const inMonth = d.getMonth() === cursor.getMonth();
                const isToday = key === todayKey;
                const isSelected = key === selected;
                const absent = onDay(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelected(key)}
                    aria-label={`${dayLabel(key)}${absent.length ? `, ${absent.length} out of office` : ''}`}
                    className={clsx(
                      'min-h-24 p-1.5 text-left align-top transition hover:bg-hover/60',
                      inMonth ? 'bg-white' : 'bg-panel/60',
                      isSelected && 'ring-2 ring-accent ring-inset',
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={clsx(
                          'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                          isToday ? 'bg-accent text-white' : inMonth ? 'text-ink' : 'text-zinc-400',
                        )}
                      >
                        {d.getDate()}
                      </span>
                      {absent.length > 0 && (
                        <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">{absent.length} out</span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {absent.slice(0, 2).map((a) => (
                        <div key={a.id} className="flex items-center gap-1 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-semibold text-amber-900">
                          <Avatar name={a.displayName} color={a.avatarColor} photo={a.avatarUrl} size={14} />
                          <span className="truncate">{a.displayName}</span>
                        </div>
                      ))}
                      {absent.length > 2 && <div className="px-1 text-[10px] font-bold text-zinc-500">+{absent.length - 2} more</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-line bg-white p-4">
              <h2 className="text-sm font-bold text-ink">Out on {dayLabel(selected)}</h2>
              {isLoading ? (
                <p className="mt-2 text-sm text-zinc-500">Loading…</p>
              ) : selectedAbsences.length === 0 ? (
                <p className="mt-2 rounded-lg border border-dashed border-zinc-300 bg-panel px-3 py-4 text-center text-sm text-zinc-500">
                  Everyone is in the office.
                </p>
              ) : (
                <ul className="mt-1 divide-y divide-line">
                  {selectedAbsences.map((a) => (
                    <AbsenceRow key={a.id} absence={a} meId={meId} canRemove={a.mine || isAdmin} onRemove={(id) => remove.mutate(id)} />
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-line bg-white p-4">
              <h2 className="text-sm font-bold text-ink">Coming up</h2>
              {upcoming.length === 0 ? (
                <p className="mt-2 text-xs text-zinc-500">No absences in this view. Use “Mark me out” to add yours.</p>
              ) : (
                <ul className="mt-1 divide-y divide-line">
                  {upcoming.map((a) => (
                    <AbsenceRow key={a.id} absence={a} meId={meId} canRemove={a.mine || isAdmin} onRemove={(id) => remove.mutate(id)} />
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </div>

      {showMarkOut && (
        <MarkOutDialog
          workspaceId={workspaceId}
          initialDate={selected >= todayKey ? selected : todayKey}
          onClose={() => setShowMarkOut(false)}
        />
      )}
    </div>
  );
}
