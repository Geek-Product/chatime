/**
 * Installability helper shared by the web app. Browsers fire `beforeinstallprompt` when the PWA
 * criteria are met; we hold the event until the user presses the app's Install button.
 */
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function isInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

window.addEventListener('beforeinstallprompt', (event) => {
  // Keep the browser's mini-infobar away; the app offers its own button instead.
  event.preventDefault();
  deferred = event as BeforeInstallPromptEvent;
  notify();
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export function canInstall(): boolean {
  return deferred !== null && !isInstalled();
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  await event.prompt();
  const choice = await event.userChoice;
  notify();
  return choice.outcome;
}
