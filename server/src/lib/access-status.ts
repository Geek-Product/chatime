import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { joinRequests, workspaceMembers } from '../db/schema';

export type AccessStatus = 'approved' | 'pending' | 'declined';

/** Newest request wins if legacy data ever produced more than one row per user. */
export async function accessStatusOf(userId: string): Promise<AccessStatus> {
  const rows = await db
    .select({ status: joinRequests.status })
    .from(joinRequests)
    .where(eq(joinRequests.userId, userId))
    .orderBy(sql`${joinRequests.createdAt} desc`)
    .limit(1);
  if (rows.length === 0) {
    // Accounts created before approval existed: approved only if they already belong to a workspace.
    const [member] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .limit(1);
    return member ? 'approved' : 'pending';
  }
  return rows[0].status === 'accepted' ? 'approved' : rows[0].status;
}

/** Workspaces where the user is owner or admin — the audiences of the sign-up list. */
export async function adminWorkspaceIds(userId: string) {
  const rows = await db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), inArray(workspaceMembers.role, ['owner', 'admin'])));
  return rows.map((r) => r.id);
}
