import webpush from 'web-push';
import { eq, inArray } from 'drizzle-orm';
import { env } from '../../env';
import { db } from '../db/index';
import { pushSubscriptions } from '../db/schema';

export const pushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
} else {
  console.warn('[push] Web Push is disabled: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set');
}

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
  /** Total unread for this user; the service worker mirrors it onto the app icon. */
  badge?: number;
}

type PayloadFor = (userId: string) => PushPayload | Promise<PushPayload>;

/**
 * Sends to every device subscription. Whether the notification is shown is decided in the
 * service worker: it suppresses the alert only when that device has a focused window. The
 * server can't use socket presence (a minimized phone keeps its socket), so it always sends.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload | PayloadFor) {
  if (!pushEnabled || userIds.length === 0) return;
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  const stale: string[] = [];

  await Promise.allSettled(subs.map(async (sub) => {
    try {
      const body = typeof payload === 'function' ? await payload(sub.userId) : payload;
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(body),
        { TTL: 60 * 60 },
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) stale.push(sub.id);
    }
  }));

  if (stale.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, stale));
}

export async function removeSubscription(endpoint: string) {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}
