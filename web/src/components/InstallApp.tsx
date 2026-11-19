import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { canInstall, promptInstall, subscribeInstall } from '../../../pwa/install';

export function InstallAppButton() {
  const [, rerender] = useState(0);

  useEffect(() => subscribeInstall(() => rerender((n) => n + 1)), []);

  if (!canInstall()) return null;

  return (
    <button
      type="button"
      onClick={() => {
        void promptInstall().then((outcome) => {
          if (outcome === 'accepted') toast.success('Installing Team Chat');
        });
      }}
      className="flex w-full items-center gap-2 border-t border-white/15 px-4 py-2 text-left text-sm text-white/70 hover:bg-white/10 hover:text-white"
    >
      <Download size={15} />
      Install app
    </button>
  );
}
