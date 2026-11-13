import { eq } from 'drizzle-orm';
import { db, sql } from '../src/db/index';
import { channelMembers, channels, messages, users, workspaceMembers, workspaces } from '../src/db/schema';
import { hashPassword } from '../src/lib/auth';

const demoUsers = [
  { username: 'andi', email: 'andi@example.com', displayName: 'Andi Pratama', title: 'PM', avatarColor: '#5865F2' },
  { username: 'budi', email: 'budi@example.com', displayName: 'Budi Santoso', title: 'Backend', avatarColor: '#57F287' },
  { username: 'sari', email: 'sari@example.com', displayName: 'Sari Wulandari', title: 'Fullstack', avatarColor: '#EB459E' },
];
const password = 'password123';
const [owner, ...others] = demoUsers;

// Earlier versions seeded these English demo accounts. Rename them in place (ids are kept) so the
// messages and workspace ownership they created stay with the same people.
const legacyUsernames: Record<string, string> = { alice: owner.username, bob: others[0].username, carol: others[1].username };

let [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, 'acme')).limit(1);
const created: Record<string, { id: string }> = {};

for (const u of demoUsers) {
  const [legacyName] = Object.entries(legacyUsernames).find(([, to]) => to === u.username) ?? [];
  if (legacyName) {
    const [legacy] = await db.select().from(users).where(eq(users.username, legacyName));
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, u.username));
    if (legacy && !taken) {
      await db
        .update(users)
        .set({ username: u.username, email: u.email, displayName: u.displayName, title: u.title, avatarColor: u.avatarColor })
        .where(eq(users.id, legacy.id));
    }
  }

  const [existing] = await db.select().from(users).where(eq(users.username, u.username));
  if (existing) {
    // Keep re-seeding useful: refresh the demo name/title/colors without touching the password.
    const [refreshed] = await db
      .update(users)
      .set({ displayName: u.displayName, title: u.title, avatarColor: u.avatarColor })
      .where(eq(users.id, existing.id))
      .returning();
    created[u.username] = refreshed;
  } else {
    const [inserted] = await db.insert(users).values({ ...u, passwordHash: await hashPassword(password) }).returning();
    created[u.username] = inserted;
  }
}

if (!ws) {
  [ws] = await db.insert(workspaces).values({ name: 'Acme', slug: 'acme', ownerId: created[owner.username].id }).returning();
}

for (const [username, u] of Object.entries(created)) {
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: ws.id, userId: u.id, role: username === owner.username ? 'owner' : 'member' })
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
    [channel] = await db.insert(channels).values({ workspaceId: ws.id, name: c.name, topic: c.topic, createdBy: created[owner.username].id }).returning();
  }
  for (const u of Object.values(created)) {
    await db.insert(channelMembers).values({ channelId: channel.id, userId: u.id }).onConflictDoNothing();
  }
  const [existingMsg] = await db.select({ id: messages.id }).from(messages).where(eq(messages.channelId, channel.id)).limit(1);
  if (!existingMsg) {
    await db.insert(messages).values([
      { channelId: channel.id, userId: created[owner.username].id, content: `Welcome to #${c.name} :wave: This is the start of the channel.` },
      { channelId: channel.id, userId: created[others[0].username].id, content: `Thanks ${owner.displayName.split(' ')[0]}! Happy to be here.` },
    ]);
  }
}

console.log(
  'Seeded workspace "Acme" with users:',
  demoUsers.map((u) => `${u.username} (${u.title})`).join(', '),
  `(password: ${password})`,
);
await sql.end();
