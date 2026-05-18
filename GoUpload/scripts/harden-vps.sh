#!/usr/bin/env bash
# harden-vps.sh — one-shot installer to lock down the goupload VPS.
#
# Run ONCE as root on the server (e.g. via `sudo bash harden-vps.sh`).
# Idempotent: safe to re-run after pulling a new copy of this repo.
#
# What it does:
#   1. Installs dangerous-guard.sh into /etc/profile.d/ so every
#      interactive shell (root included) gets the rm -rf / dd of=/dev/sd*
#      tripwires.
#   2. Installs protect-env.sh into /usr/local/sbin/ (root:root 0750).
#   3. Writes /etc/sudoers.d/goupload-hardening with:
#        - Defaults timestamp_timeout=0    (re-auth on every sudo)
#        - Defaults logfile=/var/log/sudo.log
#        - Narrow NOPASSWD for the deploy user → /usr/local/sbin/protect-env.sh
#      Validated with `visudo -cf` before install — bad syntax means we
#      bail rather than break sudo.
#   4. Locks /opt/goupload + .env files to root:root 0600.
#
# DEPLOY_USER defaults to the user that owns /opt/goupload, falling back
# to "deploy". Override with: DEPLOY_USER=ubuntu sudo -E bash harden-vps.sh

set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "harden-vps: must run as root (try: sudo bash $0)" >&2
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
GUARD_SRC="${SCRIPT_DIR}/dangerous-guard.sh"
PROTECT_SRC="${SCRIPT_DIR}/protect-env.sh"
COMPOSE_SRC="${SCRIPT_DIR}/goupload-compose.sh"
DEPLOY_DIR=/opt/goupload

for f in "$GUARD_SRC" "$PROTECT_SRC" "$COMPOSE_SRC"; do
  if [[ ! -f "$f" ]]; then
    echo "harden-vps: missing companion script $f" >&2
    exit 1
  fi
done

# Best-effort discovery of the deploy user.
if [[ -z "${DEPLOY_USER:-}" ]]; then
  if [[ -d "$DEPLOY_DIR" ]]; then
    DEPLOY_USER=$(stat -c '%U' "$DEPLOY_DIR" 2>/dev/null || echo deploy)
  else
    DEPLOY_USER=deploy
  fi
fi
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "harden-vps: deploy user '$DEPLOY_USER' not found — set DEPLOY_USER=<name> and re-run" >&2
  exit 1
fi
echo "harden-vps: using deploy user = $DEPLOY_USER"

# 1. /etc/profile.d/dangerous-guard.sh
install -m 0644 -o root -g root "$GUARD_SRC" /etc/profile.d/dangerous-guard.sh
echo "harden-vps: installed /etc/profile.d/dangerous-guard.sh"

# 2. /usr/local/sbin/protect-env.sh + /usr/local/sbin/goupload-compose.sh
install -m 0750 -o root -g root "$PROTECT_SRC"  /usr/local/sbin/protect-env.sh
install -m 0750 -o root -g root "$COMPOSE_SRC"  /usr/local/sbin/goupload-compose.sh
echo "harden-vps: installed /usr/local/sbin/{protect-env,goupload-compose}.sh"

# 3. sudoers drop-in — validate before install.
SUDOERS_TMP=$(mktemp /etc/sudoers.d/.goupload-hardening.XXXXXX)
trap 'rm -f "$SUDOERS_TMP"' EXIT
cat > "$SUDOERS_TMP" <<EOF
# Managed by GoUpload/scripts/harden-vps.sh — do not edit by hand.

# Re-authenticate on every sudo invocation. The default 5-minute cached
# credential window is a real risk for an unattended root shell.
Defaults    timestamp_timeout=0

# Audit log — sudo writes every successful + failed command here.
Defaults    logfile=/var/log/sudo.log
Defaults    log_input,log_output
Defaults    iolog_dir=/var/log/sudo-io

# Narrow NOPASSWD: deploy user can ONLY invoke these two wrappers — nothing
# else. NOPASSWD overrides timestamp_timeout=0 for these specific commands,
# which is exactly what we want (CI doesn't prompt) while every OTHER
# `sudo` invocation still requires a fresh password.
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/local/sbin/protect-env.sh, /usr/local/sbin/goupload-compose.sh
EOF
chmod 0440 "$SUDOERS_TMP"

if ! visudo -cf "$SUDOERS_TMP" >/dev/null; then
  echo "harden-vps: sudoers syntax check failed — aborting" >&2
  exit 1
fi
mv "$SUDOERS_TMP" /etc/sudoers.d/goupload-hardening
trap - EXIT
echo "harden-vps: installed /etc/sudoers.d/goupload-hardening"

# Make sure the iolog dir exists with safe perms.
install -d -m 0700 -o root -g root /var/log/sudo-io
touch /var/log/sudo.log
chown root:root /var/log/sudo.log
chmod 0600      /var/log/sudo.log

# 4. We intentionally do NOT add the deploy user to the docker group.
#    docker-group membership is effectively root and would let a
#    compromised CI account `docker run -v /:/host` to read every secret.
#    Compose runs exclusively via the goupload-compose.sh wrapper above.

# 5. Lock env files right now (so this run alone fixes a leaky deploy).
if [[ -d "$DEPLOY_DIR" ]]; then
  /usr/local/sbin/protect-env.sh
fi

echo
echo "✓ Hardening complete. Open a NEW shell to pick up the guard."
echo "  Test with:  rm -rf /tmp/__nope__   (should block & ask for phrase)"
echo "  Verify   :  sudo -l                 (should show only protect-env.sh)"
