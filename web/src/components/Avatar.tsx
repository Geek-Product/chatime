import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { assetUrl } from '../lib/api';

export function Avatar({
  name,
  color,
  photo,
  size = 36,
  online,
  className,
}: {
  name: string;
  color: string;
  /** Relative attachment URL of an uploaded profile photo; initials are drawn when absent or broken. */
  photo?: string | null;
  size?: number;
  online?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [photo]);
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className={clsx('relative shrink-0', className)} style={{ width: size, height: size }}>
      {photo && !broken ? (
        <img
          data-avatar=""
          src={assetUrl(photo)}
          alt=""
          draggable={false}
          onError={() => setBroken(true)}
          className="h-full w-full rounded-md bg-panel object-cover"
        />
      ) : (
        <div
          data-avatar=""
          className="flex h-full w-full items-center justify-center rounded-md font-bold text-white"
          style={{ background: color, fontSize: size * 0.4 }}
        >
          {initials}
        </div>
      )}
      {online !== undefined && (
        <span
          data-presence={online ? 'online' : 'offline'}
          className={clsx(
            'absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-transparent',
            online ? 'bg-emerald-500' : 'bg-zinc-300',
          )}
          style={{ width: size * 0.3, height: size * 0.3 }}
        />
      )}
    </div>
  );
}
