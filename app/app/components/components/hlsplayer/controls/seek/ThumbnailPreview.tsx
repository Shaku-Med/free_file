import { useMemo } from 'react';
import type { ThumbnailSpriteMeta } from '../../PlayerContext';
import { getFrameAtTime } from './functions/thumbnailSprite';
import { formatTime } from './functions/formatTime';

interface ThumbnailPreviewProps {
  meta: ThumbnailSpriteMeta;
  spriteUrl: string;
  time: number;
  parentWidth: number;
  cursorX: number;
  /** Chapter title for the hovered position, shown above the timestamp. */
  caption?: string;
  /**
   * Mobile / mini seek: sit just above the visible rail instead of above the
   * tall hit-area (which left a large empty gap under the preview).
   */
  tight?: boolean;
  /** Mini dock: rail is flush to the bottom of the hit area. */
  flushBottom?: boolean;
  /** Music bar: rail is flush to the top — preview stacks upward from the bar. */
  flushTop?: boolean;
}

/** Desktop watch ceiling — never larger than this on a wide player. */
const PREVIEW_MAX_W = 160;
const PREVIEW_MAX_H = 120;
/** Floor so tiny mini docks still show a readable scrub preview. */
const PREVIEW_MIN_W = 64;

export default function ThumbnailPreview({
  meta,
  spriteUrl,
  time,
  parentWidth,
  cursorX,
  caption,
  tight = false,
  flushBottom = false,
  flushTop = false,
}: ThumbnailPreviewProps) {
  const frame = useMemo(() => getFrameAtTime(meta, time), [meta, time]);
  if (!frame) return null;

  const cellAspect = frame.width / frame.height;
  // Scale with the seek track: mini (~280px) and mobile chrome get a smaller
  // preview; wide desktop still tops out at PREVIEW_MAX_*.
  const widthFactor = tight ? 0.32 : 0.38;
  const adaptiveMaxW = Math.min(
    PREVIEW_MAX_W,
    Math.max(PREVIEW_MIN_W, Math.round(parentWidth * widthFactor)),
  );
  const adaptiveMaxH = Math.min(PREVIEW_MAX_H, Math.round(adaptiveMaxW * 0.75));

  let previewW: number;
  let previewH: number;
  if (cellAspect >= 1) {
    previewW = adaptiveMaxW;
    previewH = Math.round(adaptiveMaxW / cellAspect);
  } else {
    previewH = adaptiveMaxH;
    previewW = Math.round(adaptiveMaxH * cellAspect);
  }

  const half = previewW / 2;
  const left = Math.max(0, Math.min(cursorX - half, parentWidth - previewW));

  const scale = Math.min(previewW / frame.width, previewH / frame.height);
  const totalW = meta.cols * frame.width;
  const totalH = meta.rows * frame.height;
  const compact = tight || previewW < 120;

  return (
    <div
      className="absolute pointer-events-none z-50 transition-opacity duration-150 ease-out"
      style={{
        left,
        width: previewW,
        ...(flushTop
          ? { bottom: '100%', marginBottom: 8 }
          : tight
            ? {
                bottom: flushBottom
                  ? 'calc(var(--hls-ctrl-seek-track, 3px) + 4px)'
                  : 'calc((var(--hls-ctrl-seek-hit, 2.25rem) + var(--hls-ctrl-seek-track, 3px)) / 2 + 4px)',
              }
            : { bottom: '100%', marginBottom: 8 }),
      }}
    >
      <div
        className="rounded-md overflow-hidden border border-none shadow-xl shadow-black/30 bg-background/80 flex items-center justify-center"
        style={{ width: previewW, height: previewH }}
      >
        <div
          style={{
            width: frame.width * scale,
            height: frame.height * scale,
            backgroundImage: `url(${spriteUrl})`,
            backgroundSize: `${totalW * scale}px ${totalH * scale}px`,
            backgroundPosition: `-${frame.x * scale}px -${frame.y * scale}px`,
          }}
        />
      </div>
      <div className="mt-0.5 flex flex-col items-center gap-0.5">
        {caption && (
          <span
            className={
              compact
                ? 'max-w-full truncate rounded bg-black/85 px-1 py-0.5 text-[10px] font-medium text-white'
                : 'max-w-full truncate rounded-md bg-black/85 px-1.5 py-0.5 text-[11px] font-medium text-white'
            }
          >
            {caption}
          </span>
        )}
        <span
          className={
            compact
              ? 'text-[10px] font-medium text-white bg-secondary px-1 py-0.5 rounded'
              : 'text-[11px] font-medium text-white bg-secondary px-1.5 py-0.5 rounded-md'
          }
        >
          {formatTime(time)}
        </span>
      </div>
    </div>
  );
}
