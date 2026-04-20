import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import PipLayout from './components/PipLayout';
import {
  getOpenerForPipHandshake,
  isPipSurfaceAllowed,
  PIP_MESSAGE_ORIGIN,
} from './pipEnv';

export default function PipRoute() {
  const navigate = useNavigate();
  const { pipId } = useParams();
  const [searchParams] = useSearchParams();
  const embedParam = searchParams.get('embed') === '1';
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const allowed = useMemo(
    () => mounted && isPipSurfaceAllowed(embedParam),
    [mounted, embedParam]
  );

  useEffect(() => {
    if (!mounted || allowed) return;
    navigate('/', { replace: true });
  }, [mounted, allowed, navigate]);

  useEffect(() => {
    if (!allowed || !pipId) return;

    const notifyClose = () => {
      getOpenerForPipHandshake()?.postMessage(
        {
          type: 'pip-closing',
          time: 0,
          id: pipId,
        },
        PIP_MESSAGE_ORIGIN
      );
    };

    window.addEventListener('beforeunload', notifyClose);
    return () => window.removeEventListener('beforeunload', notifyClose);
  }, [allowed, pipId]);

  if (!mounted || !allowed || !pipId) {
    return null;
  }

  return <PipLayout pipId={pipId} />;
}
