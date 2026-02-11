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

export default function ThumbnailPreview({ meta, spriteUrl, time, parentWidth, cursorX }: ThumbnailPreviewProps) {
  const frame = useMemo(() => getFrameAtTime(meta, time), [meta, time]);
  if (!frame) return null;

  const previewW = 160;
  const previewH = 90;
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
        className="rounded-lg overflow-hidden border border-zinc-600/40 shadow-xl shadow-black/30 bg-zinc-900 flex items-center justify-center"
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
        <span className="text-[11px] font-medium text-zinc-100 bg-zinc-800/90 px-1.5 py-0.5 rounded-md">
          {formatTime(time)}
        </span>
      </div>
    </div>
  );
}
