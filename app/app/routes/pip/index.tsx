import { Navigate, useSearchParams } from 'react-router';

/**
 * No standalone `/pip` page — only `/pip/:uniqueId` (iframe loads that URL).
 * Legacy `?id=` redirects into the param route; otherwise send users home.
 */
export default function PipRootRedirect() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id');
  if (id) {
    const next = new URLSearchParams(searchParams);
    next.delete('id');
    const q = next.toString();
    return (
      <Navigate
        to={`/pip/${encodeURIComponent(id)}${q ? `?${q}` : ''}`}
        replace
      />
    );
  }
  return <Navigate to="/" replace />;
}
