import { useEffect, type RefObject } from 'react';

/**
 * Closes a floating panel when a pointer goes down outside `ref`, or on Escape.
 * Listeners are only attached while `open` is true.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Let an open modal own Escape: it sits above the panel and closes on its own.
      if (document.querySelector('[role="dialog"]')) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  });
}
