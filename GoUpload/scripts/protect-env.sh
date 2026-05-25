#!/usr/bin/env bash
# /usr/local/sbin/protect-env.sh
#
# Narrow root-only helper invoked by the CI deploy via sudo.
#
# Workflow:
#   1. CI scp's deploy files into ~deploy/goupload-staging/  (deploy-owned)
#   2. CI runs `sudo /usr/local/sbin/protect-env.sh`
#   3. This script copies them into /opt/goupload/ as root:root 0600 and
#      wipes the staging dir.
#
# Whitelist of source + dest paths is hard-coded — sudoers grants
# NOPASSWD with NO arguments, so an attacker landing on the deploy account
# can't pass arbitrary paths.
#
# Install:
#   sudo install -m 0750 -o root -g root protect-env.sh /usr/local/sbin/protect-env.sh
# Sudoers (visudo /etc/sudoers.d/goupload-hardening):
#   deploy ALL=(root) NOPASSWD: /usr/local/sbin/protect-env.sh

set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "protect-env: must run as root" >&2
  exit 1
fi

# SUDO_USER tells us which deploy account invoked us. If we're being run
# directly as root (e.g. from harden-vps.sh's initial setup), there's no
# staging step — we just re-lock whatever is already in /opt/goupload.
DEPLOY_USER="${SUDO_USER:-}"
DEPLOY_DIR=/opt/goupload

FILES=(.env goupload.env nsfwapi.env loadplay.env docker-compose.yml)

# Ensure /opt/goupload exists + safe perms.
install -d -m 0750 -o root -g root "$DEPLOY_DIR"

if [[ -n "$DEPLOY_USER" ]] && id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  STAGING="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)/goupload-staging"
  if [[ -d "$STAGING" ]]; then
    for name in "${FILES[@]}"; do
      src="$STAGING/$name"
      dst="$DEPLOY_DIR/$name"
      if [[ -e "$src" ]]; then
        # Reject symlinks — defense against the deploy user swapping a
        # path for a link to /etc/shadow before we copy.
        if [[ -L "$src" ]]; then
          echo "protect-env: refusing symlink at $src" >&2
          exit 2
        fi
        # `install` atomically replaces the dest with new owner+mode.
        install -m 0600 -o root -g root "$src" "$dst"
      fi
    done
    # Self-update the runtime wrappers if newer versions were scp'd into
    # staging. This is what makes the workflow real CI/CD — pushing a fix
    # to goupload-compose.sh or dangerous-guard.sh now propagates on the
    # next deploy without manual ssh-in-and-curl steps.
    #
    # We intentionally DO NOT self-update protect-env.sh itself: a broken
    # version of this script would brick future deploys with no easy
    # recovery. That one stays manual on purpose.
    if [[ -f "$STAGING/goupload-compose.sh" && ! -L "$STAGING/goupload-compose.sh" ]]; then
      install -m 0750 -o root -g root "$STAGING/goupload-compose.sh" /usr/local/sbin/goupload-compose.sh
      echo "protect-env: refreshed /usr/local/sbin/goupload-compose.sh"
    fi
    if [[ -f "$STAGING/dangerous-guard.sh" && ! -L "$STAGING/dangerous-guard.sh" ]]; then
      install -m 0644 -o root -g root "$STAGING/dangerous-guard.sh" /etc/profile.d/dangerous-guard.sh
      echo "protect-env: refreshed /etc/profile.d/dangerous-guard.sh"
    fi

    # Wipe staging so the secrets don't linger in the deploy user's home.
    rm -f "$STAGING"/*.env "$STAGING/.env" "$STAGING/docker-compose.yml" \
          "$STAGING/goupload-compose.sh" "$STAGING/dangerous-guard.sh" 2>/dev/null || true
    rmdir --ignore-fail-on-non-empty "$STAGING" 2>/dev/null || true
  fi
fi

# Re-lock anything already in /opt/goupload (safety net for files moved
# manually or by an older deploy).
for name in "${FILES[@]}"; do
  f="$DEPLOY_DIR/$name"
  if [[ -e "$f" && ! -L "$f" ]]; then
    chown root:root "$f"
    chmod 0600      "$f"
  fi
done

# compose.yml isn't secret per se, but loosen it just enough that the
# docker group can read it if you ever exec compose without sudo.
if getent group docker >/dev/null 2>&1; then
  cf="$DEPLOY_DIR/docker-compose.yml"
  if [[ -e "$cf" && ! -L "$cf" ]]; then
    chown root:docker "$cf"
    chmod 0640        "$cf"
  fi
fi

echo "protect-env: locked $DEPLOY_DIR"
