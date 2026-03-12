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
}

const PREVIEW_MAX_W = 160;
const PREVIEW_MAX_H = 120;

export default function ThumbnailPreview({ meta, spriteUrl, time, parentWidth, cursorX }: ThumbnailPreviewProps) {
  const frame = useMemo(() => getFrameAtTime(meta, time), [meta, time]);
  if (!frame) return null;

  const cellAspect = frame.width / frame.height;
  let previewW: number;
  let previewH: number;
  if (cellAspect >= 1) {
    previewW = PREVIEW_MAX_W;
    previewH = Math.round(PREVIEW_MAX_W / cellAspect);
  } else {
    previewH = PREVIEW_MAX_H;
    previewW = Math.round(PREVIEW_MAX_H * cellAspect);
  }

  const half = previewW / 2;
  const left = Math.max(0, Math.min(cursorX - half, parentWidth - previewW));

  const scale = Math.min(previewW / frame.width, previewH / frame.height);
  const totalW = meta.cols * frame.width;
  const totalH = meta.rows * frame.height;

  return (
    <div
      className="absolute bottom-full mb-2 pointer-events-none z-50 transition-opacity duration-150 ease-out"
      style={{ left, width: previewW }}
    >
      <div
        className="rounded-lg overflow-hidden border border-none shadow-xl shadow-black/30 bg-background/80 flex items-center justify-center"
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
      <div className="text-center mt-1">
        <span className="text-[11px] font-medium text-white bg-secondary px-1.5 py-0.5 rounded-md">
          {formatTime(time)}
        </span>
      </div>
    </div>
  );
}
