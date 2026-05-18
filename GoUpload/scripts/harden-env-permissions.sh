#!/usr/bin/env bash
# Harden secret-ish files on disk: root-owned, mode 600, so normal users must use sudo
# to read them. Run on the server as root after deploy (or from CI as root).
#
# Usage:
#   sudo ./harden-env-permissions.sh /opt/myapp /var/www/app
#
# Only touches regular files matched by name below (not symlinks). Prefer passing only
# application roots (not entire /home) to avoid surprises.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <dir> [dir...]" >&2
  exit 1
fi

for root in "$@"; do
  [[ -d "$root" ]] || { echo "Not a directory: $root" >&2; exit 1; }
done

while IFS= read -r -d '' f; do
  if [[ -f "$f" && ! -L "$f" ]]; then
    chown root:root "$f"
    chmod u=rw,go= "$f"
    printf 'hardened: %s\n' "$f"
  fi
done < <(find "$@" -xdev \( -name '.env' -o -name '.env.*' -o -name '.envrc' -o -name '.pgpass' \
  -o -name '*.pem' -o -name 'id_rsa' -o -name 'id_rsa.pub' -o -name 'id_ed25519' -o -name 'id_ed25519.pub' \
  -o -name '*.p12' -o -name '*.pfx' -o -name 'credentials' -o -name 'credentials.json' -o -name 'secrets.json' \
  \) -type f -print0 2>/dev/null)
