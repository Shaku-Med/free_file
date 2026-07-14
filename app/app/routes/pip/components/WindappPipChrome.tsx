import { X } from 'lucide-react';
import { detectWindapp } from '~/lib/hooks/useWindapp';
import {
  getLastPipPlaybackState,
  isWindappPipSurface,
  requestPipClosingHandshake,
} from '~/routes/pip/pipEnv';

/**
 * Frameless Electron PiP: drag strip + close. Only mounts in windapp when /pip
 * is the top-level window (not Document PiP iframe).
 */
export function WindappPipChrome({ pipId }: { pipId: string }) {
  if (typeof window === 'undefined') return null;
  if (!detectWindapp() || !isWindappPipSurface()) return null;
  if (window.parent !== window) return null;

  return (
    <div
      className="windapp-drag pointer-events-auto absolute inset-x-0 top-0 z-[60] flex h-9 items-center justify-end bg-gradient-to-b from-black/70 to-transparent px-1.5"
      data-windapp-pip-chrome
    >
      <button
        type="button"
        className="windapp-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-white/90 hover:bg-white/15"
        aria-label="Close picture in picture"
        onClick={() => {
          const st = getLastPipPlaybackState();
          requestPipClosingHandshake(st?.time ?? 0, st?.id ?? pipId, st?.paused ?? false);
          try {
            window.close();
          } catch {
            /* ignore */
          }
          try {
            void window.memoriesWindapp?.close?.();
          } catch {
            /* ignore */
          }
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
