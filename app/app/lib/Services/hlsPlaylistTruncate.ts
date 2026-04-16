/**
 * Truncate a media playlist so total EXTINF duration does not exceed maxSeconds.
 * Used for guest preview so segments beyond the limit are never listed (and thus not fetched).
 */
export function truncateHlsMediaPlaylistAtDuration(m3u8Text: string, maxSeconds: number): string {
  const lines = m3u8Text.split(/\r?\n/);
  const firstExtinf = lines.findIndex((l) => l.startsWith("#EXTINF:"));
  if (firstExtinf === -1) return m3u8Text;

  const header = lines.slice(0, firstExtinf);
  let accumulated = 0;
  const body: string[] = [];

  for (let i = firstExtinf; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#EXTINF:")) continue;
    const m = line.match(/^#EXTINF:([0-9.]+)/);
    const dur = m ? parseFloat(m[1]) : 0;
    const uriLine = lines[i + 1];
    if (!uriLine || uriLine.startsWith("#")) {
      continue;
    }
    if (accumulated >= maxSeconds) break;
    if (accumulated + dur > maxSeconds) break;
    body.push(line, uriLine);
    accumulated += dur;
    i++;
  }

  if (body.length === 0 && firstExtinf !== -1) {
    const line = lines[firstExtinf];
    const uriLine = lines[firstExtinf + 1];
    if (line?.startsWith("#EXTINF:") && uriLine && !uriLine.startsWith("#")) {
      body.push(line, uriLine);
    }
  }

  if (body.length === 0) {
    return m3u8Text;
  }

  const out = [...header, ...body];
  if (!out.some((l) => l.trim() === "#EXT-X-ENDLIST")) {
    out.push("#EXT-X-ENDLIST");
  }
  return out.join("\n");
}
