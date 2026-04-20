import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

export default function PipLegacyRedirect() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const searchKey = useMemo(() => searchParams.toString(), [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(searchKey);
    const id = params.get('id');
    if (!id) {
      navigate('/', { replace: true });
      return;
    }
    params.delete('id');
    const q = params.toString();
    navigate(`/pip/${encodeURIComponent(id)}${q ? `?${q}` : ''}`, {
      replace: true,
    });
  }, [navigate, searchKey]);

  return null;
}
