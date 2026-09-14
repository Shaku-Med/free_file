// M:SS, MM:SS and H:MM:SS. Shared by clickable description links and seek bar
// chapters, so any time that renders as a link is read the same way by both.

const TIMESTAMP_SOURCE = String.raw`\b(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\b`;

export function createTimestampRegex(): RegExp {
  return new RegExp(TIMESTAMP_SOURCE, "g");
}

export function timestampMatchToSeconds(m: RegExpMatchArray): number {
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (m[3] == null) return a * 60 + b;
  return a * 3600 + b * 60 + Number(m[3]);
}
