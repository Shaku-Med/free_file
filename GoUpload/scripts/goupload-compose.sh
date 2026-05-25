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
shift || true

case "$ACTION" in
  pull|up|down|restart|ps|logs|prune|login|logout)
    ;;
  *)
    echo "goupload-compose: unsupported action '${ACTION}'" >&2
    echo "  allowed: pull | up | down | restart | ps | logs | prune | login | logout" >&2
    echo "  optional service list after pull/up: goupload | nsfwapi | loadplay | redis" >&2
    exit 2
    ;;
esac

# Optional service list after the action — whitelisted names only.
SERVICES=()
if [[ $# -gt 0 && "$ACTION" != "login" ]]; then
  allowed=" goupload nsfwapi loadplay redis "
  for svc in "$@"; do
    if [[ "$allowed" != *" ${svc} "* ]]; then
      echo "goupload-compose: unsupported service '${svc}'" >&2
      exit 2
    fi
    SERVICES+=("$svc")
  done
fi

cd "$DEPLOY_DIR"

case "$ACTION" in
  pull)
    if [[ ${#SERVICES[@]} -gt 0 ]]; then
      exec docker compose pull -- "${SERVICES[@]}"
    fi
    exec docker compose pull
    ;;
  up)
    if [[ ${#SERVICES[@]} -gt 0 ]]; then
      exec docker compose up -d --remove-orphans -- "${SERVICES[@]}"
    fi
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
    # leak into `ps`/audit logs). Username is $1 after the action shift.
    user="${1:-}"
    if [[ -z "$user" ]]; then
      echo "goupload-compose: login requires username arg" >&2
      exit 2
    fi
    # Read stdin into memory FIRST. sudo-rs (Ubuntu 24.04+) doesn't always
    # forward the parent's stdin pipe through to an exec'd child, which makes
    # `docker login --password-stdin` complain "cannot perform an interactive
    # login from a non TTY device". Pulling the token into a variable here
    # and re-piping it via printf works on both classic sudo and sudo-rs.
    token=$(cat)
    if [[ -z "$token" ]]; then
      echo "goupload-compose: login token missing on stdin" >&2
      exit 2
    fi
    printf '%s' "$token" | docker login ghcr.io -u "$user" --password-stdin
    ;;
  logout)
    exec docker logout ghcr.io
    ;;
esac
