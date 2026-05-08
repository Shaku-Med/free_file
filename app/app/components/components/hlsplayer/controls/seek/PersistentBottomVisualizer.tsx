import { isMobile } from 'react-device-detect';
import { usePlayerContext } from '../../PlayerContext';
import AudioVisualizerBars from './AudioVisualizerBars';

/**
 * Visualizer strip stacked below the control buttons inside the ControlBar flex-col.
 * Pushes controls upward in the layout.
 */
export default function PersistentBottomVisualizer() {
  const { audioVisualizer } = usePlayerContext();
  if (!audioVisualizer || isMobile) return null;

  return (
    <div className="w-full shrink-0 px-3 pb-2 pointer-events-none opacity-60">
      <AudioVisualizerBars />
    </div>
  );
}
