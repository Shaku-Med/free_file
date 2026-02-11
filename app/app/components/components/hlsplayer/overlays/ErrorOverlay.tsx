import { AlertTriangle } from 'lucide-react';

export default function ErrorOverlay() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black">
      <div className="text-center">
        <AlertTriangle className="w-10 h-10 text-white/50 mx-auto mb-2" />
        <p className="text-white/70 text-sm">Failed to load video</p>
      </div>
    </div>
  );
}
