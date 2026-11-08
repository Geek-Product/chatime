import clsx from 'clsx';

export function Avatar({
  name,
  color,
  size = 36,
  online,
  className,
}: {
  name: string;
  color: string;
  size?: number;
  online?: boolean;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className={clsx('relative shrink-0', className)} style={{ width: size, height: size }}>
      <div
        data-avatar=""
        className="flex h-full w-full items-center justify-center rounded-md font-bold text-white"
        style={{ background: color, fontSize: size * 0.4 }}
      >
        {initials}
      </div>
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
