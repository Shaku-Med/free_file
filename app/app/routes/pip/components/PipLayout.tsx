import { VerticalFeed } from '~/components/vertical-feed';

interface PipLayoutProps {
  pipId: string;
}

/** PiP window uses the same `/api/reel-feed` path as the main vertical feed (not `/api/pip-feed`). */
export default function PipLayout({ pipId }: PipLayoutProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-black text-foreground">
      <VerticalFeed initialActiveId={pipId} className="w-full flex-1 min-h-0" />
    </div>
  );
}
