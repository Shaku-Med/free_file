import { motion } from 'framer-motion';
import { RotateCcw, RotateCw } from 'lucide-react';

interface SeekFeedbackProps {
  direction: 'back' | 'forward';
  seconds: number;
  fading: boolean;
}

export default function SeekFeedback({ direction, seconds, fading }: SeekFeedbackProps) {
  const isBack = direction === 'back';

  return (
    <div
      className={`absolute inset-0 z-20 flex items-center pointer-events-none ${
        isBack ? 'justify-start pl-[15%]' : 'justify-end pr-[15%]'
      }`}
      aria-hidden
    >
      <motion.div
        className={`flex items-center gap-2 rounded-full bg-black/60 backdrop-blur-md px-4 py-3 shadow-lg ${
          isBack ? 'flex-row' : 'flex-row-reverse'
        }`}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{
          scale: fading ? 0.9 : 1,
          opacity: fading ? 0 : 1,
        }}
        transition={{
          scale: { duration: fading ? 0.25 : 0.2, ease: fading ? 'easeIn' : [0.34, 1.56, 0.64, 1] },
          opacity: { duration: fading ? 0.25 : 0.15 },
        }}
      >
        {isBack ? (
          <RotateCcw className="w-9 h-9 text-white shrink-0" strokeWidth={2.5} />
        ) : (
          <RotateCw className="w-9 h-9 text-white shrink-0" strokeWidth={2.5} />
        )}
        <span className="text-white text-lg font-semibold tabular-nums">{seconds}</span>
      </motion.div>
    </div>
  );
}
