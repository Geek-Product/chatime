/** URL of a user's uploaded photo; null means the UI draws initials in their color. */
export const avatarUrl = (attachmentId: string | null | undefined) =>
  attachmentId ? `/api/attachments/${attachmentId}` : null;
