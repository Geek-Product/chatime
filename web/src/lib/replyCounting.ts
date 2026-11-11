type Counted = { id: string; replyCount: number };
type Page = { messages: Counted[]; hasMore: boolean };

const withCount = <T extends Counted>(messages: T[], parentId: string, count: number) =>
  messages.map((m) => (m.id === parentId ? { ...m, replyCount: count } : m));

/**
 * Writes the server's reply total onto the parent message. It is a value, never a delta, so the
 * sender's POST response and the realtime echo can both apply it without double-counting.
 * The visible list can be a paginated snapshot rather than the query cache; both get updated.
 */
export function setReplyCount<P extends Page>(
  qc: { setQueriesData: <T>(filters: { queryKey: unknown[] }, updater: (prev: T | undefined) => T | undefined) => unknown },
  setPending: (updater: (prev: P | null) => P | null) => void,
  parentId: string,
  count: number,
) {
  qc.setQueriesData<Page>({ queryKey: ['messages'] }, (prev) =>
    prev && { ...prev, messages: withCount(prev.messages, parentId, count) });
  setPending((prev) =>
    prev && prev.messages.some((m) => m.id === parentId)
      ? { ...prev, messages: withCount(prev.messages, parentId, count) }
      : prev);
}
