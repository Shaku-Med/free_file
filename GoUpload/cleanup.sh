#!/bin/bash

# GoUpload: full wipe of upload/ and tmp/ – frees all space, leaves no trace.
# App recreates dirs on first use. Run from GoUpload project root.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== GoUpload Full Cleanup ==="
echo "Working directory: $SCRIPT_DIR"
echo ""

wipe() {
  local dir="$1"
  local name="$2"
  if [ -d "$dir" ]; then
    size=$(du -sh "$dir" 2>/dev/null | cut -f1 || echo "?")
    count=$(find "$dir" -type f 2>/dev/null | wc -l || echo "0")
    echo "Wiping $name: $count files, $size"
    rm -rf "$dir"
    echo "  Gone."
  else
    echo "Skip $name: not present"
  fi
}

wipe "upload" "upload/ (chunks, assembled, temp_processing, hls, thumbnails)"
wipe "tmp"     "tmp/ (air build, logs)"

echo ""
echo "=== Cleanup complete; all trace removed ==="

if command -v df &>/dev/null; then
  echo ""
  df -h "$SCRIPT_DIR" 2>/dev/null | tail -1
fi
