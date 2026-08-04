import { Fragment, useState, type ReactNode } from 'react';

interface ShortcutOverlayProps {
  onClose: () => void;
  /** When false (guest watch), omit theater / mini-player bindings. */
  authPlaybackFeatures?: boolean;
}

export type ShortcutPlatform = 'mac' | 'windows' | 'linux' | 'other';

/** Best-effort OS for labeling keys (overlay only mounts on the client when opened). */
export function detectShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent.toLowerCase();
  const p = (navigator.platform || '').toLowerCase();
  if (p.includes('mac') || ua.includes('mac os') || ua.includes('iphone') || ua.includes('ipad'))
    return 'mac';
  if (p.includes('win') || ua.includes('windows')) return 'windows';
  if (ua.includes('android')) return 'linux';
  if (p.includes('linux') || ua.includes('linux') || ua.includes('cros')) return 'linux';
  return 'other';
}

function platformBlurb(os: ShortcutPlatform): string {
  switch (os) {
    case 'mac':
      return 'Shown for macOS and Apple keyboards. ⇧ is the Shift key.';
    case 'windows':
      return 'Shown for Windows. Use the Shift key for shortcuts that combine two keys.';
    case 'linux':
      return 'Shown for Linux and most PC keyboards. Use Shift for combined shortcuts.';
    default:
      return 'Shown for a standard US QWERTY layout (PC). Use Shift for combined shortcuts.';
  }
}

function platformHeading(os: ShortcutPlatform): string {
  switch (os) {
    case 'mac':
      return 'Mac';
    case 'windows':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return 'Keyboard';
  }
}

type Chord = string[];

interface ShortcutDef {
  desc: string;
  /** Each entry is one key chord; multiple entries are alternatives (or). */
  alts: (os: ShortcutPlatform) => Chord[];
}

const shift = (os: ShortcutPlatform) => (os === 'mac' ? '⇧' : 'Shift');

const SHORTCUTS_ALWAYS: ShortcutDef[] = [
  {
    desc: 'Play / Pause',
    alts: () => [['Space'], ['K']],
  },
  {
    desc: 'Rewind 5 seconds',
    alts: () => [['←'], ['J']],
  },
  {
    desc: 'Forward 5 seconds',
    alts: () => [['→'], ['L']],
  },
  {
    desc: 'Volume up',
    alts: () => [['↑']],
  },
  {
    desc: 'Volume down',
    alts: () => [['↓']],
  },
  {
    desc: 'Mute / Unmute',
    alts: () => [['M']],
  },
  {
    desc: 'Fullscreen on / off',
    alts: () => [['F'], ['Esc']],
  },
  {
    desc: 'Jump to 0%, 10% ... 90%',
    alts: () => [['0'], ['9']],
  },
  {
    desc: 'Next video',
    alts: (os) => [[shift(os), 'N']],
  },
  {
    desc: 'Decrease speed',
    alts: (os) => [[shift(os), ',']],
  },
  {
    desc: 'Increase speed',
    alts: (os) => [[shift(os), '.']],
  },
  {
    desc: 'Show / hide shortcuts',
    alts: (os) => [[shift(os), '/']],
  },
  {
    desc: 'Close this panel',
    alts: () => [['Esc']],
  },
];

const SHORTCUTS_AUTH_ONLY: ShortcutDef[] = [
  {
    desc: 'Theater mode',
    alts: () => [['T']],
  },
  {
    desc: 'Mini player',
    alts: () => [['I']],
  },
];

function buildList(auth: boolean): ShortcutDef[] {
  if (!auth) return [...SHORTCUTS_ALWAYS];
  const always = SHORTCUTS_ALWAYS;
  const before = always.slice(0, 7);
  const after = always.slice(7);
  return [...before, ...SHORTCUTS_AUTH_ONLY, ...after];
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="min-w-[24px] px-1.5 py-0.5 text-[11px] font-mono font-medium text-white bg-white/10 border border-white/15 rounded text-center">
      {children}
    </kbd>
  );
}

export default function ShortcutOverlay({
  onClose,
  authPlaybackFeatures = true,
}: ShortcutOverlayProps) {
  const [os] = useState<ShortcutPlatform>(detectShortcutPlatform);
  const shortcuts = buildList(authPlaybackFeatures);
  const sh = shift(os);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900/95 border border-white/10 rounded-xl shadow-2xl backdrop-blur-md p-5 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3">
          <h3 className="text-white text-sm font-semibold">Keyboard shortcuts</h3>
          <p className="text-white/55 text-[11px] mt-1 leading-snug">
            <span className="font-medium text-white/70">{platformHeading(os)}</span>
            <span className="text-white/40"> · </span>
            {platformBlurb(os)}
          </p>
        </div>
        <div className="space-y-1.5">
          {shortcuts.map(({ desc, alts }) => {
            const options = alts(os);
            return (
              <div key={desc} className="flex items-center justify-between gap-3">
                <span className="text-white/70 text-xs">{desc}</span>
                <span className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
                  {options.map((chord, ai) => (
                    <Fragment key={ai}>
                      {ai > 0 ? (
                        <span className="text-[10px] font-medium text-white/35 uppercase tracking-wide">
                          or
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-0.5">
                        {chord.map((key, ki) => (
                          <Fragment key={`${key}-${ki}`}>
                            {ki > 0 ? (
                              <span className="text-white/40 text-[10px] px-0.5" aria-hidden>
                                +
                              </span>
                            ) : null}
                            <Kbd>{key}</Kbd>
                          </Fragment>
                        ))}
                      </span>
                    </Fragment>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-white/30 text-[10px] mt-3 text-center leading-relaxed">
          Press <Kbd>{sh}</Kbd>
          <span className="text-white/40"> + </span>
          <Kbd>/</Kbd> for this help, or <Kbd>Esc</Kbd> to close
        </p>
      </div>
    </div>
  );
}
