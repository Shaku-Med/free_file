#!/usr/bin/env bash
# Copy dangerous-guard.sh + optional sudoers fragment onto a Linux server.
# Must run as root.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GUARD_SRC="${SCRIPT_DIR}/dangerous-guard.sh"
GUARD_DST=/etc/profile.d/dangerous-guard.sh
SUDOERS_SRC="${SCRIPT_DIR}/sudoers.d-no-cache"
SUDOERS_DST=/etc/sudoers.d/99-no-sudo-cache

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

if [[ ! -f "$GUARD_SRC" ]]; then
  echo "Missing $GUARD_SRC" >&2
  exit 1
fi

install -m 0644 "$GUARD_SRC" "$GUARD_DST"
echo "Installed $GUARD_DST (interactive bash only; open a new shell to load)."

if [[ -f "$SUDOERS_SRC" ]]; then
  tmp=$(mktemp)
  cat "$SUDOERS_SRC" >"$tmp"
  if visudo -cf "$tmp"; then
    install -m 0440 -o root -g root "$tmp" "$SUDOERS_DST"
    rm -f "$tmp"
    echo "Installed $SUDOERS_DST (timestamp_timeout=0)."
  else
    rm -f "$tmp"
    echo "visudo rejected sudoers fragment; not installed. Fix $SUDOERS_SRC and re-run." >&2
    exit 1
  fi
fi
