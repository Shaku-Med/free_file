import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from '~/components/icons';

interface SeekFeedbackProps {
  direction: 'back' | 'forward';
  seconds: number;
  fading: boolean;
}

export default function SeekFeedback({ direction, seconds, fading }: SeekFeedbackProps) {
  const isBack = direction === 'back';
  const Chevron = isBack ? ChevronLeft : ChevronRight;

  return (
    <div
      className={`absolute inset-0 z-20 flex items-center pointer-events-none ${
        isBack ? 'justify-start pl-[15%]' : 'justify-end pr-[15%]'
      }`}
      aria-hidden
    >
      <motion.div
        // No backing pill: the glyphs carry their own shadow so they stay
        // readable on bright frames without dimming the video behind them.
        className={`flex items-center gap-1.5 drop-shadow-[0_2px_6px_rgba(0,0,0,0.75)] ${
          isBack ? 'flex-row' : 'flex-row-reverse'
        }`}
        initial={{ opacity: 0, x: isBack ? 10 : -10 }}
        animate={{ opacity: fading ? 0 : 1, x: 0 }}
        transition={{ duration: fading ? 0.25 : 0.15, ease: 'easeOut' }}
      >
        {/* Remix glyphs are filled, so weight comes from the shape itself
            rather than a stroke width. */}
        <Chevron className="h-9 w-9 shrink-0 text-white" />
        <span className="text-2xl font-semibold tabular-nums text-white">
          {isBack ? '−' : '+'} {seconds}
        </span>
      </motion.div>
    </div>
  );
}
