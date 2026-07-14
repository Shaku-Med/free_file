import { useEffect, useMemo, useState } from 'react';
import { data, useLoaderData, useNavigate, useParams, useSearchParams } from 'react-router';
import db from '~/lib/Database/supabase';
import { loadSecurePipFeed } from '~/routes/Api/fun/loadSecurePipFeed';
import type { FileType } from '~/lib/types';
import {
  getLastPipPlaybackState,
  isPipSurfaceAllowed,
  requestNavigateFromPipToMain,
  requestPipClosingHandshake,
} from './pipEnv';
import { PipReelContainer } from './components';
import { WindappPipChrome } from './components/WindappPipChrome';

/** Same shape as `/api/pip-feed` and reel feed: per-file like/dislike from `enrichFeedFilesWithInteractions`. */
export type PipLoaderUserActions = {
  likedFileIds: string[];
  dislikedFileIds: string[];
};

export interface PipLoaderData {
  file: FileType | null;
  items: FileType[];
  id: string;
  accessDenied: boolean;
  reason?: string;
  userActions: PipLoaderUserActions;
  /** Seed the server rolled for this feed  echo back on pagination so pages align. */
  seed: string | null;
  /** Cursor for the next page (`GET /api/pip-feed`), or null if exhausted. */
  nextCursor: { cursor_pos: number } | null;
}

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { pipId: string };
}) {
  try {
    if (!db) {
      throw new Error('Database not initialized');
    }

    const uniqueId = params.pipId?.trim();
    if (!uniqueId) {
      return data(
        {
          file: null,
          items: [],
          id: '',
          accessDenied: false,
          userActions: { likedFileIds: [], dislikedFileIds: [] },
          seed: null,
          nextCursor: null,
        } satisfies PipLoaderData,
        { status: 400 },
      );
    }

    const url = new URL(request.url);
    const result = await loadSecurePipFeed(request, url, uniqueId);

    if (!result.ok) {
      const body = result.body;
      if (result.status === 404 && body.notFound) {
        return data(
          {
            file: null,
            items: [],
            id: uniqueId,
            accessDenied: false,
            userActions: { likedFileIds: [], dislikedFileIds: [] },
            seed: null,
            nextCursor: null,
          } satisfies PipLoaderData,
          { status: 404 },
        );
      }
      if (result.status === 403 && body.accessDenied) {
        return data(
          {
            file: null,
            items: [],
            id: uniqueId,
            accessDenied: true,
            reason: typeof body.reason === 'string' ? body.reason : undefined,
            userActions: { likedFileIds: [], dislikedFileIds: [] },
            seed: null,
            nextCursor: null,
          } satisfies PipLoaderData,
          { status: 403 },
        );
      }
      if (result.status === 400) {
        return data(
          {
            file: null,
            items: [],
            id: uniqueId,
            accessDenied: false,
            userActions: { likedFileIds: [], dislikedFileIds: [] },
            seed: null,
            nextCursor: null,
          } satisfies PipLoaderData,
          { status: 400 },
        );
      }
      throw new Error('PiP feed failed');
    }

    const items = result.data as FileType[];
    const file = items[0] ?? null;

    if (!file) {
      return data(
        {
          file: null,
          items: [],
          id: uniqueId,
          accessDenied: false,
          userActions: { likedFileIds: [], dislikedFileIds: [] },
          seed: null,
          nextCursor: null,
        } satisfies PipLoaderData,
        { status: 404 },
      );
    }

    return data({
      file,
      items,
      id: uniqueId,
      accessDenied: false,
      userActions: {
        likedFileIds: result.likedFileIds,
        dislikedFileIds: result.dislikedFileIds,
      },
      seed: result.seed,
      nextCursor: result.nextCursor,
    } satisfies PipLoaderData);
  } catch (e) {
    console.error('Pip loader:', e);
    throw e;
  }
}

export default function PipByIdRoute() {
  const loaderData = useLoaderData<PipLoaderData>();
  const navigate = useNavigate();
  const { pipId } = useParams();
  const [searchParams] = useSearchParams();
  const embedParam = searchParams.get('embed') === '1';
  const initialStartTime = useMemo(() => {
    const raw = searchParams.get('t');
    if (raw == null || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [searchParams]);
  const initialPaused = searchParams.get('paused') === '1';
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const allowed = useMemo(
    () => mounted && isPipSurfaceAllowed(embedParam),
    [mounted, embedParam],
  );

  useEffect(() => {
    if (!mounted || allowed) return;
    navigate('/', { replace: true });
  }, [mounted, allowed, navigate]);

  useEffect(() => {
    if (!allowed || !pipId) return;

    const notifyClose = () => {
      // Hand the last known position/play-state back so the main player resumes there (not at 0).
      const st = getLastPipPlaybackState();
      requestPipClosingHandshake(st?.time ?? 0, st?.id ?? pipId, st?.paused ?? false);
    };

    window.addEventListener('beforeunload', notifyClose);
    return () => window.removeEventListener('beforeunload', notifyClose);
  }, [allowed, pipId]);

  /** In-app links: close Document PiP and navigate the main window (iframe has no opener chain). */
  useEffect(() => {
    if (!allowed) return;

    const onClickCapture = (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const el = (e.target as Element | null)?.closest?.('a[href]');
      if (!el || !(el instanceof HTMLAnchorElement)) return;
      const href = el.getAttribute('href');
      if (href == null || href === '' || href.startsWith('#')) return;
      const trimmed = href.trim();
      if (/^(mailto:|tel:|javascript:)/i.test(trimmed)) return;
      if (el.hasAttribute('download')) return;

      let url: URL;
      try {
        url = new URL(trimmed, window.location.origin);
      } catch {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const dest =
        url.origin === window.location.origin ? url.pathname + url.search + url.hash : url.href;
      requestNavigateFromPipToMain(dest);
    };

    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, [allowed]);

  if (!mounted || !allowed || !pipId) {
    return null;
  }

  if (!loaderData.file || loaderData.items.length === 0) {
    return (
      <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center bg-black px-4 text-center text-sm text-zinc-400">
        {loaderData.accessDenied
          ? loaderData.reason ?? 'You do not have access.'
          : 'Video unavailable.'}
      </div>
    );
  }

  return (
    <div className="pip-reel-root relative min-h-0 flex-1 bg-black" data-pip-route={pipId}>
      <WindappPipChrome pipId={pipId} />
      <PipReelContainer
        items={loaderData.items}
        initialActiveId={pipId}
        centerUniqueId={pipId}
        className="min-h-0 flex-1"
        userActions={loaderData.userActions}
        seed={loaderData.seed}
        initialNextCursor={loaderData.nextCursor}
        initialStartTime={initialStartTime}
        initialPaused={initialPaused}
      />
    </div>
  );
}
