import { eq } from 'drizzle-orm';
import { db, sql } from '../src/db/index';
import { channelMembers, channels, messages, users, workspaceMembers, workspaces } from '../src/db/schema';
import { hashPassword } from '../src/lib/auth';

const demoUsers = [
  { username: 'alice', email: 'alice@example.com', displayName: 'Alice Johnson', avatarColor: '#5865F2' },
  { username: 'bob', email: 'bob@example.com', displayName: 'Bob Smith', avatarColor: '#57F287' },
  { username: 'carol', email: 'carol@example.com', displayName: 'Carol Diaz', avatarColor: '#EB459E' },
];
const password = 'password123';

let [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, 'acme')).limit(1);
const created: Record<string, { id: string }> = {};

for (const u of demoUsers) {
  const [existing] = await db.select().from(users).where(eq(users.username, u.username));
  created[u.username] = existing ?? (await db.insert(users).values({ ...u, passwordHash: await hashPassword(password) }).returning())[0];
}

if (!ws) {
  [ws] = await db.insert(workspaces).values({ name: 'Acme', slug: 'acme', ownerId: created.alice.id }).returning();
}

for (const [username, u] of Object.entries(created)) {
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: ws.id, userId: u.id, role: username === 'alice' ? 'owner' : 'member' })
    .onConflictDoNothing();
}

const channelNames = [
  { name: 'general', topic: 'Company-wide announcements and work-based matters' },
  { name: 'random', topic: 'Non-work banter and water cooler conversation' },
  { name: 'engineering', topic: 'Builds, deploys and code talk' },
];

for (const c of channelNames) {
  let [channel] = await db.select().from(channels).where(eq(channels.name, c.name));
  if (!channel) {
    [channel] = await db.insert(channels).values({ workspaceId: ws.id, name: c.name, topic: c.topic, createdBy: created.alice.id }).returning();
  }
  for (const u of Object.values(created)) {
    await db.insert(channelMembers).values({ channelId: channel.id, userId: u.id }).onConflictDoNothing();
  }
  const [existingMsg] = await db.select({ id: messages.id }).from(messages).where(eq(messages.channelId, channel.id)).limit(1);
  if (!existingMsg) {
    await db.insert(messages).values([
      { channelId: channel.id, userId: created.alice.id, content: `Welcome to #${c.name} :wave: This is the start of the channel.` },
      { channelId: channel.id, userId: created.bob.id, content: 'Thanks Alice! Happy to be here.' },
    ]);
  }
}

console.log('Seeded workspace "Acme" with users:', Object.keys(created).join(', '), `(password: ${password})`);
await sql.end();
