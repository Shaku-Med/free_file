#!/usr/bin/env bash
# Why did an upload skip its thumbnails, preview, waveform or fingerprints?
#
#   bash upload-diagnose.sh            # last 2h across all uploads
#   bash upload-diagnose.sh <upload_id>
#
# Paste the output. Nothing here prints a secret; the storage repo is already
# redacted by the purge handler and job ids are opaque.

set -uo pipefail
SINCE="${SINCE:-2h}"
ID="${1:-}"
C="${GOUPLOAD_CONTAINER:-goupload}"

log() { printf '\n=== %s ===\n' "$1"; }
grab() { docker logs --since "$SINCE" "$C" 2>&1; }

if ! docker inspect "$C" >/dev/null 2>&1; then
  echo "container '$C' not found. Set GOUPLOAD_CONTAINER=<name> and re-run."
  docker ps --format '{{.Names}}'
  exit 1
fi

FILTER="cat"
[ -n "$ID" ] && FILTER="grep -F $ID"

log "failed jobs"
grab | $FILTER | grep -iE "job failed|failJob|vision detection failed|broken video|cannot read video metadata" | tail -30

log "per-stage results (blank stage = it never ran)"
for stage in "thumbnails available early" "thumbnail_preview" "hover_preview" "thumbnail_grid" \
             "waveform" "audio stems" "vision check" "fingerprint" "default thumbnail"; do
  n=$(grab | $FILTER | grep -cF "$stage")
  printf '  %-28s %s\n' "$stage" "$n"
done

log "stage errors"
grab | $FILTER | grep -iE "thumbnail preview failed|hover preview failed|thumbnail grid failed|waveform|stems|fingerprint register|auto default thumbnail write failed" | tail -30

log "nsfw / music sidecars (a timeout here fails the whole job today)"
grab | $FILTER | grep -iE "vision|nsfw|music api|musicdetector" | tail -20

log "sidecar health"
for svc in nsfwapi musicdetector acoustid embedapi; do
  s=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "goupload-$svc" 2>/dev/null || echo "not found")
  printf '  %-16s %s\n' "$svc" "$s"
done

log "recent restarts (an OOM kill mid-job looks like a skipped stage)"
docker inspect -f '{{.Name}} restarts={{.RestartCount}} oomkilled={{.State.OOMKilled}}' \
  "$C" goupload-nsfwapi goupload-musicdetector goupload-acoustid 2>/dev/null
