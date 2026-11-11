import { randomBytes } from 'node:crypto';
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import { env } from '../../env';
import { db } from '../db/index';
import { channelMembers, users, webhookDeliveries, webhooks, workspaceMembers } from '../db/schema';
import { assertWorkspaceAdmin } from './access';
import { AVATAR_COLORS } from './auth';
import { notFound } from './errors';

export const WEBHOOK_CONTENT_MAX = 8000;
const DELIVERIES_KEPT = 200;

/** Bots can never hold a session, so they store something argon2 can never verify. */
export const BOT_PASSWORD_SENTINEL = '!bot';

export async function createWebhookBot(workspaceId: string, name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16) || 'hook';
  const [bot] = await db
    .insert(users)
    .values({
      email: `${randomBytes(8).toString('hex')}@webhooks.local`,
      username: `webhook-${slug}-${randomBytes(3).toString('hex')}`.slice(0, 32),
      displayName: name,
      passwordHash: BOT_PASSWORD_SENTINEL,
      avatarColor: AVATAR_COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length],
      isBot: true,
    })
    .returning();
  // Workspace membership makes the bot a normal poster; it is never added to channel_members.
  await db.insert(workspaceMembers).values({ workspaceId, userId: bot.id });
  return bot;
}

export function webhookUrl(id: string, token: string) {
  return new URL(`/api/webhooks/${id}/${token}`, env.APP_URL).toString();
}

type WebhookRow = typeof webhooks.$inferSelect;

export function toWebhookDto(row: WebhookRow, secret?: string) {
  return {
    id: row.id,
    channelId: row.channelId,
    workspaceId: row.workspaceId,
    name: row.name,
    template: row.template,
    notify: row.notify,
    disabled: row.disabledAt !== null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    ...(secret ? { url: webhookUrl(row.id, secret) } : {}),
  };
}

export async function assertWebhookAdmin(webhookId: string, userId: string) {
  const [row] = await db.select().from(webhooks).where(eq(webhooks.id, webhookId));
  if (!row) throw notFound('Webhook not found');
  await assertWorkspaceAdmin(row.workspaceId, userId);
  return row;
}

function resolvePath(payload: unknown, path: string): unknown {
  let cur = payload;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function scalarText(value: unknown) {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function formatLines(value: unknown, depth = 0): string[] {
  const pad = '  '.repeat(depth);
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (item === null || typeof item !== 'object') return [`${pad}- ${scalarText(item)}`];
      if (Array.isArray(item)) return [`${pad}-`, ...formatLines(item, depth + 1)];
      const inline = Object.entries(item)
        .filter(([, v]) => v === null || typeof v !== 'object')
        .map(([k, v]) => `${k}: ${scalarText(v)}`)
        .join(' | ');
      const nested = Object.entries(item).filter(([, v]) => v !== null && typeof v === 'object');
      return [
        ...(inline ? [`${pad}- ${inline}`] : []),
        ...nested.flatMap(([k, v]) => [`${pad}  ${k}:`, ...formatLines(v, depth + 2)]),
      ];
    });
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    v === null || typeof v !== 'object'
      ? [`${pad}- ${k}: ${scalarText(v)}`]
      : [`${pad}- ${k}:`, ...formatLines(v, depth + 1)]);
}

function formatPayload(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return scalarText(payload);
  return formatLines(payload).join('\n');
}

/**
 * Turns a delivery body into message Markdown. A template substitutes `{{dot.path}}` (missing paths
 * become empty); otherwise a `text`/`content` string is used verbatim, falling back to a key/value dump.
 */
export function renderWebhookContent(payload: unknown, template: string | null) {
  if (template?.trim()) {
    return clamp(template.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_m, path: string) => scalarText(resolvePath(payload, path))));
  }
  if (typeof payload === 'string') return clamp(payload);
  if (payload && typeof payload === 'object') {
    const text = (payload as Record<string, unknown>).text ?? (payload as Record<string, unknown>).content;
    if (typeof text === 'string') return clamp(text);
    return clamp(formatPayload(payload));
  }
  return clamp(scalarText(payload));
}

/** Empty once Markdown/serialization punctuation is gone (e.g. `{}` or `[null, null]`). */
export const isBlankContent = (content: string) => content.replace(/[*_~`#>|\-<>/\\[\]{}(),:.\s]/g, '') === '';

function clamp(text: string) {
  const trimmed = text.trim();
  return trimmed.length > WEBHOOK_CONTENT_MAX ? `${trimmed.slice(0, WEBHOOK_CONTENT_MAX - 3)}...` : trimmed;
}

/** Keeps the newest 200 deliveries; older rows are dropped so the table stays bounded. */
async function pruneDeliveries(webhookId: string) {
  const keep = db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(DELIVERIES_KEPT);
  await db
    .delete(webhookDeliveries)
    .where(and(
      eq(webhookDeliveries.webhookId, webhookId),
      sql`${webhookDeliveries.id} not in (${keep})`,
    ));
}

export async function recordDelivery(
  webhookId: string,
  delivery: { status: 'ok' | 'ignored' | 'error'; messageId?: string; error?: string; payloadBytes: number },
) {
  await db.insert(webhookDeliveries).values({
    webhookId,
    status: delivery.status,
    messageId: delivery.messageId ?? null,
    error: delivery.error ?? null,
    payloadBytes: delivery.payloadBytes,
  });
  await pruneDeliveries(webhookId);
}

/**
 * Who an unsilenced announce reaches: people in the channel who still belong to the workspace.
 * Public-channel non-members are deliberately left out so an alert doesn't page the whole workspace.
 */
export async function announceRecipients(channelId: string, workspaceId: string, silenced: string[]) {
  const rows = await db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .innerJoin(workspaceMembers, and(
      eq(workspaceMembers.userId, channelMembers.userId),
      eq(workspaceMembers.workspaceId, workspaceId),
    ))
    .where(and(
      eq(channelMembers.channelId, channelId),
      silenced.length ? notInArray(channelMembers.userId, silenced) : undefined,
    ));
  return rows.map((r) => r.userId);
}
