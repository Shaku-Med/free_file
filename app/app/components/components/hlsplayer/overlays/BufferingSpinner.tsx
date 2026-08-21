import { LoaderCircle } from '~/components/icons';

export default function BufferingSpinner() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 pointer-events-none">
      <LoaderCircle className="w-12 h-12 text-white animate-spin opacity-70" />
    </div>
  );
}
