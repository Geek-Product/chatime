type NavigatorWithBadge = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Mirrors the unread total onto the installed-app icon where the Badging API exists. */
export function syncAppBadge(count: number) {
  const nav = navigator as NavigatorWithBadge;
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => {});
    else void nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    /* badging unsupported */
  }
}
