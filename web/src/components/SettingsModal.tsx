import { useEffect, useState, type FormEvent } from 'react';
import { BellRing, KeyRound, LogOut, Palette, UserRound, Volume2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from './Avatar';
import { api, setAccessToken } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../lib/push';
import { setSoundEnabled, soundEnabled } from '../lib/sound';
import { THEMES, textOn, useTheme, type ThemeName } from '../lib/theme';
import type { User } from '../lib/types';

function Toggle({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${on ? 'bg-emerald-500' : 'bg-zinc-300'}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError('New password must be at least 8 characters');
    if (next !== confirm) return setError('New passwords do not match');
    setBusy(true);
    try {
      const res = await api.post<{ accessToken: string }>('/auth/password', {
        currentPassword: current,
        newPassword: next,
      });
      // This browser got a fresh session; other devices were signed out server-side.
      setAccessToken(res.accessToken);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Password updated · other devices were signed out');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    'mt-1 w-full rounded-md border border-zinc-400 bg-white px-3 py-1.5 text-sm text-ink outline-none placeholder:text-zinc-400 focus:border-accent focus:ring-2 focus:ring-accent/30';

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-3 space-y-2">
      <label className="block text-xs font-bold text-ink">
        Current password
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={inputCls}
          required
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs font-bold text-ink">
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={inputCls}
            minLength={8}
            required
          />
        </label>
        <label className="block text-xs font-bold text-ink">
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputCls}
            minLength={8}
            required
          />
        </label>
      </div>
      {error && <p className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-700">{error}</p>}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy || !current || !next || !confirm}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </div>
    </form>
  );
}

const AVATAR_COLORS = ['#5865F2', '#EB459E', '#57F287', '#FEE75C', '#ED4245', '#3BA55D', '#FAA61A', '#9B59B6'];

function ProfileForm({ me }: { me: User }) {
  const { updateUser } = useAuth();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [username, setUsername] = useState(me.username);
  const [title, setTitle] = useState(me.title ?? '');
  const [avatarColor, setAvatarColor] = useState(me.avatarColor);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty =
    displayName.trim() !== me.displayName ||
    username !== me.username ||
    title.trim() !== (me.title ?? '') ||
    avatarColor !== me.avatarColor;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) return setError('Username: 2-32 letters, numbers, _ . -');
    if (!displayName.trim()) return setError('Display name cannot be empty');
    setBusy(true);
    try {
      const res = await api.patch<{ user: User }>('/auth/me', {
        displayName: displayName.trim(),
        username,
        title: title.trim() || null,
        avatarColor,
      });
      updateUser({
        displayName: res.user.displayName,
        username: res.user.username,
        title: res.user.title,
        avatarColor: res.user.avatarColor,
      });
      toast.success('Profile updated');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    'mt-1 w-full rounded-md border border-zinc-400 bg-white px-3 py-1.5 text-sm text-ink outline-none placeholder:text-zinc-400 focus:border-accent focus:ring-2 focus:ring-accent/30';

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-3 space-y-2">
      <label className="block text-xs font-bold text-ink">
        Display name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} className={inputCls} required />
      </label>
      <label className="block text-xs font-bold text-ink">
        Username
        <div className="mt-1 flex items-center rounded-md border border-zinc-400 bg-white px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
          <span className="text-sm text-zinc-500">@</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s+/g, ''))}
            maxLength={32}
            className="w-full bg-transparent px-1 py-1.5 text-sm text-ink outline-none"
            aria-label="Username"
            required
          />
        </div>
        <span className="mt-1 block text-xs font-normal text-zinc-500">People mention you with @{username || 'username'}.</span>
      </label>
      <label className="block text-xs font-bold text-ink">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          placeholder="e.g. PM, Backend, Fullstack"
          className={inputCls}
        />
        <span className="mt-1 block text-xs font-normal text-zinc-500">Shown on your profile card and in member lists.</span>
      </label>
      <div className="text-xs font-bold text-ink">
        Avatar color
        <div className="mt-1 flex items-center gap-2">
          <Avatar name={displayName || me.username} color={avatarColor} size={34} />
          <div className="flex flex-wrap gap-1.5">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setAvatarColor(c)}
                aria-label={`Avatar color ${c}`}
                aria-pressed={avatarColor === c}
                className={`h-6 w-6 rounded-full border-2 ${avatarColor === c ? 'border-zinc-900' : 'border-transparent'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>
      {error && <p className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-700">{error}</p>}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy || !dirty}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  );
}

export function SettingsModal({
  me,
  onClose,
  onLogout,
  initialTab = 'preferences',
}: {
  me: User;
  onClose: () => void;
  onLogout: () => void;
  initialTab?: 'preferences' | 'profile' | 'account';
}) {
  const [pushOn, setPushOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supported] = useState(pushSupported);
  const [sound, setSound] = useState(soundEnabled);
  const [tab, setTab] = useState<'preferences' | 'profile' | 'account'>(initialTab);
  const theme = useTheme();

  useEffect(() => {
    currentSubscription().then((s) => setPushOn(Boolean(s))).catch(() => {});
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
        toast.success('Desktop notifications disabled');
      } else {
        await enablePush();
        setPushOn(true);
        toast.success('Desktop notifications enabled');
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex w-full max-w-2xl overflow-hidden rounded-xl border border-zinc-300 bg-white text-ink shadow-2xl"
        role="dialog"
        aria-label="Preferences"
      >
        <div className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-line bg-panel p-2 text-sm">
          <button
            type="button"
            onClick={() => setTab('preferences')}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left font-semibold ${tab === 'preferences' ? 'bg-white text-ink shadow-sm' : 'text-zinc-600 hover:bg-hover'}`}
          >
            <BellRing size={14} /> Preferences
          </button>
          <button
            type="button"
            onClick={() => setTab('profile')}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left font-semibold ${tab === 'profile' ? 'bg-white text-ink shadow-sm' : 'text-zinc-600 hover:bg-hover'}`}
          >
            <UserRound size={14} /> Profile
          </button>
          <button
            type="button"
            onClick={() => setTab('account')}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left font-semibold ${tab === 'account' ? 'bg-white text-ink shadow-sm' : 'text-zinc-600 hover:bg-hover'}`}
          >
            <KeyRound size={14} /> Password
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="flex items-center gap-3">
              <Avatar name={me.displayName} color={me.avatarColor} size={40} />
              <div>
                <p className="font-bold leading-tight">{me.displayName}</p>
                <p className="text-sm text-zinc-600">@{me.username} · {me.email}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded p-1 text-zinc-600 hover:bg-hover hover:text-ink" aria-label="Close preferences">
              <X size={18} />
            </button>
          </div>

          <div className="space-y-4 p-5">
            {tab === 'preferences' ? (
              <>
                <div className="rounded-lg border border-line p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="flex items-center gap-2 font-semibold">
                        <Volume2 size={16} /> Message sounds
                      </p>
                      <p className="mt-1 text-sm text-zinc-600">
                        Play a short chime when a new message arrives. Mentions get their own sound.
                      </p>
                    </div>
                    <Toggle
                      on={sound}
                      label="Toggle message sounds"
                      onClick={() => {
                        const next = !sound;
                        setSound(next);
                        setSoundEnabled(next);
                      }}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-line p-4">
                  <p className="flex items-center gap-2 font-semibold">
                    <Palette size={16} /> Sidebar color
                  </p>
                  <p className="mt-1 text-sm text-zinc-600">Pick a theme for the sidebar. Saved in this browser.</p>
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {(Object.keys(THEMES) as ThemeName[]).map((name) => {
                      const t = THEMES[name];
                      const active = theme.theme === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => theme.setTheme(name)}
                          className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs font-semibold ${active ? 'border-zinc-900 ring-2 ring-zinc-300' : 'border-zinc-300 hover:border-zinc-500'}`}
                          aria-pressed={active}
                          data-theme-option={name}
                        >
                          <span className="h-5 w-5 shrink-0 rounded border border-black/10" style={{ background: t.bg }} />
                          <span className="truncate text-ink">{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <label className="mt-3 flex items-center gap-3 text-xs font-bold text-ink">
                    Custom color
                    <input
                      type="color"
                      value={theme.custom ?? theme.color}
                      onChange={(e) => theme.setCustom(e.target.value)}
                      className="h-8 w-12 cursor-pointer rounded border border-zinc-300 bg-white p-0.5"
                      aria-label="Custom sidebar color"
                    />
                    <span
                      className="rounded px-2 py-1 text-[11px] font-semibold"
                      style={{ background: theme.custom ?? theme.color, color: textOn(theme.custom ?? theme.color) }}
                    >
                      Sample text
                    </span>
                    {theme.custom && (
                      <button type="button" onClick={() => theme.setCustom(null)} className="ml-auto font-semibold text-zinc-600 hover:underline">
                        Reset to theme
                      </button>
                    )}
                  </label>
                </div>

                <div className="rounded-lg border border-line p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="flex items-center gap-2 font-semibold">
                        <BellRing size={16} /> Desktop notifications
                      </p>
                      <p className="mt-1 text-sm text-zinc-600">
                        Get an OS notification when someone @mentions you while the app is in the background or closed.
                      </p>
                      {!supported && (
                        <p className="mt-2 text-xs font-semibold text-amber-700">
                          This browser doesn't support Web Push (or you're not on localhost/HTTPS).
                        </p>
                      )}
                      {supported && Notification.permission === 'denied' && (
                        <p className="mt-2 text-xs font-semibold text-red-600">
                          Notifications are blocked in your browser settings. Allow them for this site and try again.
                        </p>
                      )}
                    </div>
                    <Toggle on={pushOn} disabled={!supported || busy} onClick={() => void toggle()} label="Toggle desktop notifications" />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onLogout}
                  className="flex items-center gap-2 rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                >
                  <LogOut size={15} /> Sign out
                </button>
              </>
            ) : tab === 'profile' ? (
              <div className="rounded-lg border border-line p-4">
                <p className="flex items-center gap-2 font-semibold">
                  <UserRound size={16} /> Your profile
                </p>
                <p className="mt-1 text-sm text-zinc-600">
                  Your display name and avatar are shown next to your messages. Changing your username changes how people
                  @mention you.
                </p>
                <ProfileForm me={me} />
              </div>
            ) : (
              <div className="rounded-lg border border-line p-4">
                <p className="flex items-center gap-2 font-semibold">
                  <KeyRound size={16} /> Change password
                </p>
                <p className="mt-1 text-sm text-zinc-600">
                  Enter your current password, then choose a new one (at least 8 characters). Changing it signs you out on all
                  other devices.
                </p>
                <PasswordForm />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
