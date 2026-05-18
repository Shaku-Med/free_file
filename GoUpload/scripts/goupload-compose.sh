#!/usr/bin/env bash
# /usr/local/sbin/goupload-compose.sh
#
# Narrow root-only wrapper for `docker compose` against /opt/goupload.
# Lets the deploy user invoke compose against the locked-down stack
# without giving it read access to the env files (or to docker as a
# group, which is effectively root anyway).
#
# Whitelist of actions only — no `exec`, no `run`, no arbitrary shell.
#
# Install:
#   sudo install -m 0750 -o root -g root goupload-compose.sh /usr/local/sbin/goupload-compose.sh
# Sudoers:
#   deploy ALL=(root) NOPASSWD: /usr/local/sbin/goupload-compose.sh

set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "goupload-compose: must run as root" >&2
  exit 1
fi

DEPLOY_DIR=/opt/goupload
ACTION="${1:-}"

case "$ACTION" in
  pull|up|down|restart|ps|logs|prune|login|logout)
    ;;
  *)
    echo "goupload-compose: unsupported action '${ACTION}'" >&2
    echo "  allowed: pull | up | down | restart | ps | logs | prune | login | logout" >&2
    exit 2
    ;;
esac

cd "$DEPLOY_DIR"

case "$ACTION" in
  pull)
    exec docker compose pull
    ;;
  up)
    exec docker compose up -d --remove-orphans
    ;;
  down)
    exec docker compose down
    ;;
  restart)
    exec docker compose restart
    ;;
  ps)
    exec docker compose ps
    ;;
  logs)
    # Tail-only, no follow — we don't want to hold the sudo session open.
    exec docker compose logs --tail=200 --no-color
    ;;
  prune)
    exec docker image prune -f --filter "until=72h"
    ;;
  login)
    # Reads token from stdin only — we never accept it as an argv (would
    # leak into `ps`/audit logs).
    user="${2:-}"
    if [[ -z "$user" ]]; then
      echo "goupload-compose: login requires username arg" >&2
      exit 2
    fi
    exec docker login ghcr.io -u "$user" --password-stdin
    ;;
  logout)
    exec docker logout ghcr.io
    ;;
esac
