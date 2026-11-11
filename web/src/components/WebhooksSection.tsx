import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, RefreshCw, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { Webhook, WebhookWithUrl } from '../lib/types';

const EXAMPLE = '**{{alert_name}}** — {{value}} (threshold {{threshold}})';

const when = (iso: string | null) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
};

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="flex items-center gap-1 rounded-md border border-zinc-400 bg-white px-2 py-1 text-xs font-bold text-ink hover:bg-hover"
    >
      <Copy size={12} /> {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function SecretPanel({ url, onDone }: { url: string; onDone: () => void }) {
  const snippet = `curl -X POST '${url}' -H 'content-type: application/json' -d '{"alert_name":"Revenue drop","value":"-42%"}'`;
  return (
    <div className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm">
      <p className="font-bold text-emerald-900">Copy this URL now — it is shown only once.</p>
      <div className="mt-2 flex items-center gap-2">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="w-full rounded border border-zinc-400 bg-white px-2 py-1 font-mono text-xs" aria-label="Webhook URL" />
        <CopyButton text={url} />
      </div>
      <p className="mt-2 text-xs font-semibold text-zinc-700">Send any JSON to that URL, e.g. from Metabase alerts:</p>
      <div className="mt-1 flex items-start gap-2">
        <pre className="w-full overflow-x-auto rounded bg-zinc-900 p-2 text-[11px] text-zinc-100">{snippet}</pre>
        <CopyButton text={snippet} />
      </div>
      <button type="button" onClick={onDone} className="mt-2 text-xs font-bold text-emerald-800 underline">
        I saved it
      </button>
    </div>
  );
}

/** Admin-only: create and manage incoming webhooks for one channel. */
export function WebhooksSection({ channelId, workspaceId }: { channelId: string; workspaceId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [notify, setNotify] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['webhooks', workspaceId],
    queryFn: () => api.get<{ webhooks: Webhook[] }>(`/workspaces/${workspaceId}/webhooks`),
  });
  const hooks = (data?.webhooks ?? []).filter((w) => w.channelId === channelId);
  const refresh = () => qc.invalidateQueries({ queryKey: ['webhooks', workspaceId] });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ webhook: WebhookWithUrl }>(`/workspaces/${workspaceId}/webhooks`, {
        channelId,
        name: name.trim(),
        template: template.trim() || null,
        notify,
      }),
    onSuccess: ({ webhook }) => {
      setName('');
      setTemplate('');
      setNotify(false);
      setSecret(webhook.url);
      return refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { notify?: boolean; disabled?: boolean } }) =>
      api.patch<{ webhook: Webhook }>(`/webhooks/${id}`, body),
    onSuccess: () => refresh(),
    onError: (e: Error) => setError(e.message),
  });

  const rotate = useMutation({
    mutationFn: (id: string) => api.post<{ webhook: WebhookWithUrl }>(`/webhooks/${id}/rotate`),
    onSuccess: ({ webhook }) => {
      setSecret(webhook.url);
      return refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/webhooks/${id}`),
    onSuccess: () => {
      toast.success('Webhook removed');
      return refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const busy = create.isPending || edit.isPending || rotate.isPending || remove.isPending;

  return (
    <div className="mt-5 rounded-md border border-line p-3">
      <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
        <WebhookIcon size={14} /> Webhooks
      </p>
      <p className="mt-1 text-xs text-zinc-600">
        Let Metabase, Grafana, Zapier or any script post updates here. Messages appear as{' '}
        <b>{name.trim() || 'the webhook’s name'}</b>.
      </p>

      <ul className="mt-3 space-y-2" aria-label="Webhooks">
        {hooks.map((w) => (
          <li key={w.id} className="rounded border border-line bg-panel px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{w.name}</span>
              {w.disabled && <span className="rounded bg-zinc-200 px-1.5 text-[10px] font-bold text-zinc-700">disabled</span>}
              <span className="ml-auto text-[11px] text-zinc-500">used {when(w.lastUsedAt)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-zinc-600">
              <label className="flex items-center gap-1 font-semibold">
                <input type="checkbox" checked={w.notify} disabled={busy} onChange={(e) => edit.mutate({ id: w.id, body: { notify: e.target.checked } })} />
                Notify channel members
              </label>
              <label className="flex items-center gap-1 font-semibold">
                <input type="checkbox" checked={!w.disabled} disabled={busy} onChange={(e) => edit.mutate({ id: w.id, body: { disabled: !e.target.checked } })} />
                Enabled
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Rotate “${w.name}”? The current URL stops working immediately.`)) rotate.mutate(w.id);
                }}
                className="ml-auto flex items-center gap-1 font-semibold text-zinc-700 hover:text-ink disabled:opacity-50"
              >
                <RefreshCw size={11} /> Rotate URL
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Delete “${w.name}”? Its past messages stay in the channel.`)) remove.mutate(w.id);
                }}
                className="flex items-center gap-1 font-semibold text-red-700 hover:text-red-800 disabled:opacity-50"
              >
                <Trash2 size={11} /> Delete
              </button>
            </div>
          </li>
        ))}
        {hooks.length === 0 && <li className="px-1 text-xs text-zinc-500">No webhooks yet.</li>}
      </ul>

      {secret && <SecretPanel url={secret} onDone={() => setSecret(null)} />}

      <div className="mt-3 border-t border-line pt-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="Name shown as the author, e.g. Metabase"
          aria-label="Webhook name"
          className="w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-zinc-400 focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          maxLength={4000}
          rows={2}
          placeholder={`Optional template, e.g. ${EXAMPLE}`}
          aria-label="Message template"
          className="mt-2 w-full resize-y rounded-md border border-zinc-400 bg-white px-3 py-2 font-mono text-xs text-ink outline-none placeholder:text-zinc-400 focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          <code>{'{{path.to.field}}'}</code> is replaced from the JSON body (array indexes like <code>{'{{rows.0.region}}'}</code>{' '}
          work too). Without a template, a <code>{'{"text": "..."}'}</code> field or a key/value summary is posted.
        </p>
        <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-zinc-700">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Notify channel members (in-app + desktop)
        </label>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => {
            setError(null);
            create.mutate();
          }}
          className="mt-2 flex items-center gap-1 rounded-md bg-purple-800 px-3 py-1.5 text-sm font-bold text-white hover:bg-purple-900 disabled:opacity-50"
        >
          <Plus size={13} /> {create.isPending ? 'Creating…' : 'Create webhook'}
        </button>
      </div>

      {error && <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
    </div>
  );
}
