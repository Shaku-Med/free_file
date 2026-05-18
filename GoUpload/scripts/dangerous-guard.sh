# /etc/profile.d/dangerous-guard.sh
#
# Catches obvious foot-gun commands in interactive shells (every user, root
# included) and forces a typed confirmation + fresh sudo re-auth before
# letting them proceed. Non-interactive shells / scripts that explicitly
# call `command rm` / `/bin/rm` bypass this so CI deploys still work.
#
# Patterns covered (not exhaustive — defense in depth, not a sandbox):
#   rm -rf /, rm -rf /*, rm -rf /<root-dir>
#   dd  ...  of=/dev/sd*, /dev/nvme*, /dev/mmcblk*, /dev/hd*
#   mkfs.* on a block device
#   chmod / chown recursive on / or /etc /var /usr /opt /home
#   find / ... -delete
#   redirection that overwrites /etc /boot /root files (> /etc/passwd etc.)
#   fork bomb :(){ :|:& };:
#   piping curl|sh, wget|sh, curl|bash, wget|bash
#   shutdown / reboot / halt / poweroff
#   Sensitive reads: cat/less/head/tail/vi on .env, keys, PEMs, shadow, etc.
#     (skips guard when the path exists but is not readable — normal user gets
#     EPERM without a pointless prompt.)
#
# All wrappers are bash functions, so:
#   - Interactive shells get the guard.
#   - Non-interactive shells exit at the top — cron / CI / `ssh host cmd` skip it.
#   - Scripts that use the absolute path (/bin/rm, /usr/bin/cat) skip it.
#   - `command rm` / `command cat` also skip — narrow escape hatch for deploy scripts.

# Only run in interactive bash sessions — never in non-interactive shells
# (scp / rsync / ansible / cron / docker exec without -t).
case $- in *i*) ;; *) return 0 ;; esac

__guard_confirm_phrase='I UNDERSTAND THE RISK'

__guard_reauth() {
  # Invalidate cached sudo creds then force a fresh password prompt. With
  # `timestamp_timeout=0` in sudoers, this is required for *every* dangerous
  # command — defense against an attacker who already has a shell session
  # open after an unattended user walked away.
  # Note: direct root login often gets a no-op `sudo -v`; paired with
  # `harden-env-permissions.sh` + phrase confirmation, this is still a
  # useful speed bump, not a full MFA.
  sudo -k 2>/dev/null || true
  if ! sudo -v; then
    printf '\033[31m✗ Authentication failed. Command aborted.\033[0m\n' >&2
    return 1
  fi
  return 0
}

__guard_block() {
  local label=$1
  shift
  printf '\n\033[1;31m⛔  Dangerous command blocked: %s\033[0m\n' "$label" >&2
  printf '   Command: %s\n' "$*" >&2
  printf '   Type the exact phrase to confirm: \033[1m%s\033[0m\n' "$__guard_confirm_phrase" >&2
  printf '   > ' >&2
  local typed=''
  IFS= read -r typed
  if [[ "$typed" != "$__guard_confirm_phrase" ]]; then
    printf '\033[31m✗ Phrase did not match. Command aborted.\033[0m\n' >&2
    return 1
  fi
  __guard_reauth || return 1
  return 0
}

__guard_match() {
  # Returns 0 (matches) on any dangerous pattern.
  local joined="$*"
  case "$joined" in
    *'rm -rf /'|*'rm -rf /*'|*'rm -rf / '*) return 0 ;;
    *'rm -rf /etc'*|*'rm -rf /var'*|*'rm -rf /usr'*|*'rm -rf /opt'*|*'rm -rf /home'*|*'rm -rf /root'*|*'rm -rf /boot'*|*'rm -rf /lib'*|*'rm -rf /bin'*|*'rm -rf /sbin'*) return 0 ;;
    *'rm -fr /'*|*'rm -Rf /'*) return 0 ;;
    *':(){:|:&};:'*|*':(){ :|:& };:'*) return 0 ;;
    *'mkfs.'*|*'mkfs '*) return 0 ;;
    *'dd '*'of=/dev/sd'*|*'dd '*'of=/dev/nvme'*|*'dd '*'of=/dev/mmcblk'*|*'dd '*'of=/dev/hd'*) return 0 ;;
    *'chmod -R '*' /'*|*'chmod -R '*' /etc'*|*'chmod -R '*' /var'*|*'chmod -R '*' /usr'*) return 0 ;;
    *'chown -R '*' /'*|*'chown -R '*' /etc'*|*'chown -R '*' /var'*|*'chown -R '*' /usr'*) return 0 ;;
    *'find / '*' -delete'*|*'find /etc'*' -delete'*|*'find /var'*' -delete'*) return 0 ;;
    *'> /etc/'*|*'>> /etc/'*|*'> /boot/'*|*'> /root/'*) return 0 ;;
    *'curl '*'| sh'*|*'curl '*'|sh'*|*'wget '*'| sh'*|*'wget '*'|sh'*) return 0 ;;
    *'curl '*'| bash'*|*'curl '*'|bash'*|*'wget '*'| bash'*|*'wget '*'|bash'*) return 0 ;;
    *'shutdown '*|*'reboot'|*'halt'|*'poweroff'|*'init 0'*|*'init 6'*) return 0 ;;
  esac
  return 1
}

# Any argument that looks like a secret-bearing path (and is readable if it exists).
__guard_sensitive_read_args() {
  local a
  for a in "$@"; do
    [[ "$a" == -* ]] && continue
    [[ -z "$a" ]] && continue
    if [[ -e "$a" && ! -r "$a" ]]; then
      continue
    fi
    case "$a" in
      /etc/shadow|/etc/gshadow|/etc/sudoers|/etc/ssh/sshd_config|/etc/sudoers.d/*)
        return 0
        ;;
    esac
    case "$a" in
      *.key)
        __guard_sensitive_key_path "$a" && return 0
        continue
        ;;
    esac
    case "$a" in
      *.env|*.env.*|.envrc|.pgpass|*.pem|id_rsa|id_rsa.pub|id_ed25519|id_ed25519.pub|\
      *.p12|*.pfx|*credentials.json|*secrets.json|*/.aws/credentials|*/.ssh/id_*|*/.gnupg/*)
        return 0
        ;;
    esac
  done
  return 1
}

# Avoid flagging unrelated "*.key" paths unless they look TLS/SSH/private-ish.
__guard_sensitive_key_path() {
  case "$1" in
    *secrets*|*secret*|*private*|*\.ssh*|*certs*|*cert*|*tls*|*ssl*|*/keys/id_*)
      return 0
      ;;
  esac
  return 1
}

__guard_read_wrapper() {
  local name=$1
  shift
  if __guard_sensitive_read_args "$@"; then
    __guard_block "sensitive read" "$name $*" || return 1
  fi
  command "$name" "$@"
}

rm() {
  if __guard_match "rm $*"; then
    __guard_block "rm" "rm $*" || return 1
  fi
  command rm "$@"
}

dd() {
  if __guard_match "dd $*"; then
    __guard_block "dd" "dd $*" || return 1
  fi
  command dd "$@"
}

chmod() {
  if __guard_match "chmod $*"; then
    __guard_block "chmod" "chmod $*" || return 1
  fi
  command chmod "$@"
}

chown() {
  if __guard_match "chown $*"; then
    __guard_block "chown" "chown $*" || return 1
  fi
  command chown "$@"
}

find() {
  if __guard_match "find $*"; then
    __guard_block "find" "find $*" || return 1
  fi
  command find "$@"
}

shutdown() { __guard_block "shutdown" "shutdown $*" || return 1; command shutdown "$@"; }
reboot()   { __guard_block "reboot"   "reboot $*"   || return 1; command reboot "$@"; }
halt()     { __guard_block "halt"     "halt $*"     || return 1; command halt "$@"; }
poweroff() { __guard_block "poweroff" "poweroff $*" || return 1; command poweroff "$@"; }

cat()  { __guard_read_wrapper cat "$@"; }
less() { __guard_read_wrapper less "$@"; }
more() { __guard_read_wrapper more "$@"; }
head() { __guard_read_wrapper head "$@"; }
tail() { __guard_read_wrapper tail "$@"; }
nl()   { __guard_read_wrapper nl "$@"; }

vi()  { __guard_read_wrapper vi "$@"; }
vim() { __guard_read_wrapper vim "$@"; }
nano() { __guard_read_wrapper nano "$@"; }

# Catches pipes-into-shell that aren't otherwise visible to per-command
# wrappers (since the dangerous part is the *next* program). PROMPT_COMMAND
# can't see the *next* command, so we hook DEBUG instead.
__guard_prehook() {
  local cmd="$BASH_COMMAND"
  case "$cmd" in
    *'curl '*'| sh'*|*'curl '*'|sh'*|\
    *'curl '*'| bash'*|*'curl '*'|bash'*|\
    *'wget '*'| sh'*|*'wget '*'|sh'*|\
    *'wget '*'| bash'*|*'wget '*'|bash'*)
      __guard_block "curl|sh" "$cmd" || return 1
      ;;
  esac
  return 0
}
trap '__guard_prehook' DEBUG

readonly __guard_confirm_phrase 2>/dev/null || true
