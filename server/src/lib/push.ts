import webpush from 'web-push';
import { eq, inArray } from 'drizzle-orm';
import { env } from '../../env';
import { db } from '../db/index';
import { pushSubscriptions } from '../db/schema';
import { hub } from './hub';

export const pushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
}

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  if (!pushEnabled || userIds.length === 0) return;
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  const stale: string[] = [];

  await Promise.allSettled(subs.map(async (sub) => {
    // Only ping users who aren't currently looking at the app.
    if (hub.isOnline(sub.userId)) return;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
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
