#!/bin/bash
#
# Operate the production launchd job (com.sampolio.app) in whichever launchd
# domain it runs in, without sudo:
#
#   gui     ~/Library/LaunchAgents/com.sampolio.app.plist (per-user LaunchAgent)
#   system  /Library/LaunchDaemons/com.sampolio.app.plist (system daemon that runs
#           as the app user; secrets in ~/.sampolio/launchd.env)
#
# Usage:
#   ./scripts/prod-service.sh domain     # print gui | system | none
#   ./scripts/prod-service.sh status     # domain, pid, last exit, listener, HTTP code
#   ./scripts/prod-service.sh restart    # restart and wait until healthy (see below)
#   ./scripts/prod-service.sh snapshot   # db-snapshot.mjs with the key prod runs with
#   ./scripts/prod-service.sh hold      # hold system daemon for artifact promotion
#   ./scripts/prod-service.sh release   # release hold and wait for health
#
# restart: gui → `launchctl kickstart -k gui/<uid>/com.sampolio.app`. system → read
# the pid from `launchctl print system/com.sampolio.app` (works unprivileged),
# SIGTERM it (the daemon runs as this user, so no sudo), and let launchd respawn it
# (KeepAlive). Both then wait for a NEW pid and for http://127.0.0.1:<port>/ to
# answer 307/200. Exit 0 = healthy, 1 = not healthy in time, 2 = no job loaded.
# A system job that needs a full reload (plist change, penalty box) needs sudo;
# this script prints the commands instead of running them.
#
# snapshot: reads ENCRYPTION_KEY and DATA_DIR from ~/.sampolio/launchd.env when it
# exists, otherwise from the gui plist, and passes them to scripts/db-snapshot.mjs.
# The key never reaches stdout or the command line.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
LABEL="com.sampolio.app"
UID_N="$(id -u)"
GUI_PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
ENV_FILE="${SAMPOLIO_ENV_FILE:-$HOME/.sampolio/launchd.env}"
PORT="${SAMPOLIO_PORT:-3999}"
WAIT_S="${SAMPOLIO_RESTART_WAIT:-90}"
DEPLOY_HOLD_FILE="${SAMPOLIO_DEPLOY_HOLD_FILE:-$HOME/.sampolio/run/deploy-hold}"

domain() {
    if launchctl print "gui/$UID_N/$LABEL" >/dev/null 2>&1; then echo gui
    elif launchctl print "system/$LABEL" >/dev/null 2>&1; then echo system
    else echo none
    fi
}

target() { case "$1" in gui) echo "gui/$UID_N/$LABEL" ;; system) echo "system/$LABEL" ;; esac; }

# pid of the running job, empty when launchd has no running instance
job_pid() { launchctl print "$(target "$1")" 2>/dev/null | awk '$1 == "pid" && $2 == "=" { print $3; exit }'; }
last_exit() { launchctl print "$(target "$1")" 2>/dev/null | awk -F' = ' '$1 ~ /^[[:space:]]*last exit code$/ { print $2; exit }'; }
http_code() { curl -sS -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:${PORT}/" 2>/dev/null || true; }
listener() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { print $1, "pid=" $2, "user=" $3, $9 }'; }
has_listener() { [ -n "$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)" ]; }
send_term() {
    if [ -n "${SAMPOLIO_SIGNAL_COMMAND:-}" ]; then
        "$SAMPOLIO_SIGNAL_COMMAND" -TERM "$1"
    else
        kill -TERM "$1"
    fi
}

status() {
    local d; d="$(domain)"
    echo "domain:    $d"
    if [ "$d" != none ]; then
        echo "target:    $(target "$d")"
        echo "pid:       $(job_pid "$d")"
        echo "last exit: $(last_exit "$d")"
    fi
    echo "deploy hold: $([ -e "$DEPLOY_HOLD_FILE" ] && echo yes || echo no)"
    echo "listener:  $(listener)"
    echo "http:      $(http_code)"
    [ "$d" != none ]
}

wait_healthy() {  # $1 = domain, $2 = old pid (may be empty)
    local d="$1" old="$2" pid="" code="" i
    for i in $(seq 1 "$WAIT_S"); do
        pid="$(job_pid "$d")"
        if [ -n "$pid" ] && [ "$pid" != "$old" ]; then
            code="$(http_code)"
            case "$code" in 307|200) echo "healthy after ${i}s: $(target "$d") pid $pid, HTTP $code"; return 0 ;; esac
        fi
        sleep 1
    done
    echo "NOT healthy after ${WAIT_S}s: $(target "$d") pid '${pid}' (old '${old}'), HTTP '${code}'" >&2
    echo "last exit: $(last_exit "$d"); see ~/.sampolio/logs/sampolio-error.log" >&2
    return 1
}

require_system() {
    local d; d="$(domain)"
    [ "$d" = system ] || {
        echo "deploy hold is system-domain only (current domain: $d)" >&2
        return 1
    }
}

hold() {
    require_system || return 1
    [ ! -L "$DEPLOY_HOLD_FILE" ] || { echo "deploy hold path must not be a symlink" >&2; return 1; }
    local hold_dir old pid i
    hold_dir="$(dirname "$DEPLOY_HOLD_FILE")"
    mkdir -p -m 700 "$hold_dir" || return 1
    (umask 077; : > "$DEPLOY_HOLD_FILE") || return 1
    chmod 600 "$DEPLOY_HOLD_FILE" || return 1
    old="$(job_pid system)"
    if [ -n "$old" ]; then
        echo "holding $(target system): SIGTERM pid $old"
        send_term "$old" || { echo "could not signal job pid $old; hold remains active" >&2; return 1; }
    fi
    for i in $(seq 1 "$WAIT_S"); do
        pid="$(job_pid system)"
        if { [ -z "$old" ] || ! kill -0 "$old" 2>/dev/null; } && [ -n "$pid" ] && ! has_listener; then
            echo "held after ${i}s: $(target system) wrapper pid $pid is waiting; listener closed"
            return 0
        fi
        sleep 1
    done
    echo "NOT held after ${WAIT_S}s: old pid '$old', current pid '$pid', listener '$(listener)'" >&2
    echo "hold remains active at $DEPLOY_HOLD_FILE; inspect the service before release" >&2
    return 1
}

release_hold() {
    require_system || return 1
    [ ! -L "$DEPLOY_HOLD_FILE" ] || { echo "deploy hold path must not be a symlink" >&2; return 1; }
    [ -e "$DEPLOY_HOLD_FILE" ] || { echo "no deploy hold exists at $DEPLOY_HOLD_FILE" >&2; return 1; }
    rm -f "$DEPLOY_HOLD_FILE" || return 1
    echo "released deploy hold; waiting for healthy system service"
    wait_healthy system ""
}

restart() {
    local d old
    d="$(domain)"
    case "$d" in
        gui)
            old="$(job_pid gui)"
            echo "restarting $(target gui) (pid ${old:-none}) with kickstart -k"
            launchctl kickstart -k "$(target gui)"
            wait_healthy gui "$old"
            ;;
        system)
            old="$(job_pid system)"
            if [ -n "$old" ]; then
                echo "restarting $(target system): SIGTERM pid $old, launchd respawns it (KeepAlive)"
                kill -TERM "$old"
            else
                echo "$(target system) has no running pid; waiting for launchd to start it"
            fi
            if ! wait_healthy system "$old"; then
                cat >&2 <<EOF
If the job is stuck (penalty box) or its plist changed, reload it with sudo:
  sudo launchctl bootout system/$LABEL
  sudo launchctl bootstrap system /Library/LaunchDaemons/$LABEL.plist
EOF
                return 1
            fi
            ;;
        *)
            echo "no $LABEL job loaded in gui/$UID_N or system" >&2
            return 2
            ;;
    esac
}

snapshot() {
    local key data_dir src
    if [ -f "$ENV_FILE" ]; then
        src="$ENV_FILE"
        key="$(unset ENCRYPTION_KEY; set -a; . "$ENV_FILE"; printf '%s' "${ENCRYPTION_KEY:-}")"
        data_dir="$(unset DATA_DIR; set -a; . "$ENV_FILE"; printf '%s' "${DATA_DIR:-}")"
    elif [ -f "$GUI_PLIST" ]; then
        src="$GUI_PLIST"
        key="$(/usr/bin/plutil -extract EnvironmentVariables.ENCRYPTION_KEY raw "$GUI_PLIST" 2>/dev/null || true)"
        data_dir="$(/usr/bin/plutil -extract EnvironmentVariables.DATA_DIR raw "$GUI_PLIST" 2>/dev/null || true)"
    else
        echo "snapshot: neither $ENV_FILE nor $GUI_PLIST exists" >&2
        return 1
    fi
    [ -n "$key" ] || { echo "snapshot: no ENCRYPTION_KEY in $src" >&2; return 1; }
    data_dir="${data_dir:-$HOME/.sampolio/data}"
    if [ ! -f "$data_dir/sampolio.db" ]; then
        echo "snapshot: $data_dir/sampolio.db does not exist yet; nothing to snapshot"
        return 0
    fi
    # shellcheck source=lib-node.sh
    . "$SCRIPT_DIR/lib-node.sh"
    sampolio_activate_node "$REPO_ROOT"
    echo "snapshot: key from $src, DATA_DIR=$data_dir"
    ( cd "$REPO_ROOT" && ENCRYPTION_KEY="$key" DATA_DIR="$data_dir" node scripts/db-snapshot.mjs )
}

case "${1:-}" in
    domain) domain ;;
    status) status ;;
    restart) restart ;;
    snapshot) snapshot ;;
    hold) hold ;;
    release) release_hold ;;
    -h|--help|"") sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; [ -n "${1:-}" ] ;;
    *) echo "unknown command: $1 (domain | status | restart | snapshot | hold | release)" >&2; exit 64 ;;
esac
