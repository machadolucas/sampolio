#!/bin/bash

# Sampolio launchd Installation Script
# Runs the app automatically via `next start` from this git clone.
# Build first with ./scripts/server-deploy.sh, then run this.
#
# The Node.js binary path is resolved at install time (honoring .nvmrc) and baked
# into the plist, so launchd uses the intended version without depending on an
# interactive shell or version manager at boot.
#
# Two launchd domains (same label, com.sampolio.app):
#
#   SAMPOLIO_LAUNCHD_DOMAIN=gui (default)
#       Per-user LaunchAgent in ~/Library/LaunchAgents, started at login. The env,
#       secrets included, is baked into the 0600 plist. Loads the agent.
#
#   SAMPOLIO_LAUNCHD_DOMAIN=system
#       System LaunchDaemon that runs as the current user and starts at boot, so
#       it survives the loss of the GUI login session. Prepares, but does not
#       install: writes the env to ~/.sampolio/launchd.env (0600), renders a
#       secret-free plist that runs scripts/launchd-run.sh to
#       ~/.sampolio/launchd/com.sampolio.app.system.plist, and prints the sudo
#       steps. It never runs sudo and never touches a loaded job.
#       launchd.env source, first match wins: an existing launchd.env (kept
#       as-is; delete it to regenerate), the env block of the gui plist (the
#       values prod runs with), or ~/sampolio/.env plus the data-dir fallbacks.

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuration
PLIST_NAME="com.sampolio.app"
PLIST_FILE="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="$HOME/.sampolio/logs"
DATA_DIR="$HOME/.sampolio/data"
PORT="${SAMPOLIO_PORT:-3999}"
# Loopback only: the sole clients are the local reverse proxy (Caddy) and
# cloudflared. Set SAMPOLIO_HOST=0.0.0.0 to expose the app on the LAN.
HOST="${SAMPOLIO_HOST:-127.0.0.1}"
# Build dir prod serves — isolated from dev's `.next` (see next.config.ts). Baked
# into the plist below so `next start` reads the same dir server-deploy.sh built.
NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-prod}"

DOMAIN="${SAMPOLIO_LAUNCHD_DOMAIN:-gui}"
SYSTEM_PLIST="/Library/LaunchDaemons/${PLIST_NAME}.plist"
ENV_FILE="$HOME/.sampolio/launchd.env"
STAGE_DIR="$HOME/.sampolio/launchd"
STAGED_PLIST="$STAGE_DIR/${PLIST_NAME}.system.plist"
case "$DOMAIN" in
    gui|system) ;;
    *) echo -e "${RED}Error: SAMPOLIO_LAUNCHD_DOMAIN must be gui or system (got '$DOMAIN').${NC}"; exit 2 ;;
esac

# A gui agent next to a system daemon with the same label would fight over the
# port. Once the system daemon exists, only the system mode may run.
if [ "$DOMAIN" = gui ] && { [ -f "$SYSTEM_PLIST" ] || launchctl print "system/${PLIST_NAME}" >/dev/null 2>&1; }; then
    echo -e "${RED}Error: ${PLIST_NAME} is installed as a system daemon ($SYSTEM_PLIST).${NC}"
    echo "Re-run with SAMPOLIO_LAUNCHD_DOMAIN=system, or remove the daemon first (sudo)."
    exit 1
fi

if [ "$DOMAIN" = system ]; then
    echo -e "${YELLOW}=== Sampolio system daemon: prepare (no sudo) ===${NC}"
else
    echo -e "${YELLOW}=== Sampolio Auto-Start Installation ===${NC}"
fi
echo ""

# --- Resolve the Node.js binary to bake into the plist -----------------------
# shellcheck source=lib-node.sh
. "$SCRIPT_DIR/lib-node.sh"
sampolio_activate_node "$REPO_ROOT"

# process.execPath is the real, stable install path (not an ephemeral shell shim)
NODE_PATH="$(node -e 'process.stdout.write(process.execPath)')"
if [ -z "$NODE_PATH" ] || [ ! -x "$NODE_PATH" ]; then
    echo -e "${RED}Error: could not resolve a usable Node.js binary path.${NC}"
    exit 1
fi

# System mode keeps the node the gui agent already runs, so the cutover changes
# only the launchd domain (nvm may resolve a newer patch of the same major).
# SAMPOLIO_NODE=/path/to/node overrides; after the cutover (no gui plist) the
# .nvmrc resolution above is used, which is what a Node-version change wants.
if [ "$DOMAIN" = system ]; then
    CANDIDATE="${SAMPOLIO_NODE:-}"
    if [ -z "$CANDIDATE" ] && [ -f "$PLIST_FILE" ]; then
        CANDIDATE="$(/usr/bin/plutil -extract ProgramArguments.0 raw "$PLIST_FILE" 2>/dev/null || true)"
    fi
    if [ -n "$CANDIDATE" ]; then
        if [ -x "$CANDIDATE" ] && [ "$("$CANDIDATE" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" = "$(node -p 'process.versions.node.split(".")[0]')" ]; then
            NODE_PATH="$CANDIDATE"
        else
            echo -e "${RED}Error: $CANDIDATE is not an executable node of the .nvmrc major.${NC}"
            exit 1
        fi
    fi
fi
NODE_BIN_DIR="$(dirname "$NODE_PATH")"

echo "Node.js:                $($NODE_PATH -v) ($NODE_PATH)"
echo "Installation directory: $REPO_ROOT"
echo ""

# Make sure the app is installed and built
if [ ! -f "$REPO_ROOT/node_modules/next/dist/bin/next" ] || [ ! -f "$REPO_ROOT/$NEXT_DIST_DIR/BUILD_ID" ]; then
    echo -e "${RED}Error: app isn't installed/built. Run ./scripts/server-deploy.sh first.${NC}"
    exit 1
fi

# Create log and data directories
mkdir -p "$LOG_DIR"
mkdir -p "$DATA_DIR"

# Resolve the env from ~/sampolio/.env, falling back to (or generating) the
# per-data-dir secret files. Sets AUTH_SECRET, ENCRYPTION_KEY, AUTH_URL and any
# optional variables .env defines.
resolve_env_from_dotenv() {
    # Load .env file if it exists
    if [ -f "$REPO_ROOT/.env" ]; then
        echo -e "${GREEN}Loading environment variables from .env file...${NC}"
        set -a
        # shellcheck disable=SC1091
        source "$REPO_ROOT/.env"
        set +a
    fi

    # Read or generate AUTH_SECRET
    if [ -z "$AUTH_SECRET" ]; then
        CONFIG_FILE="$DATA_DIR/.auth_secret"
        if [ -f "$CONFIG_FILE" ]; then
            AUTH_SECRET=$(cat "$CONFIG_FILE")
        else
            AUTH_SECRET=$(openssl rand -base64 32)
            echo "$AUTH_SECRET" > "$CONFIG_FILE"
            chmod 600 "$CONFIG_FILE"
        fi
    fi

    # Read or generate ENCRYPTION_KEY
    if [ -z "$ENCRYPTION_KEY" ]; then
        ENCRYPTION_CONFIG_FILE="$DATA_DIR/.encryption_key"
        if [ -f "$ENCRYPTION_CONFIG_FILE" ]; then
            ENCRYPTION_KEY=$(cat "$ENCRYPTION_CONFIG_FILE")
        else
            ENCRYPTION_KEY=$(openssl rand -hex 32)
            echo "$ENCRYPTION_KEY" > "$ENCRYPTION_CONFIG_FILE"
            chmod 600 "$ENCRYPTION_CONFIG_FILE"
        fi
    fi

    # Persist or restore AUTH_URL
    AUTH_URL_CONFIG_FILE="$DATA_DIR/.auth_url"
    if [ -n "$AUTH_URL" ]; then
        echo "$AUTH_URL" > "$AUTH_URL_CONFIG_FILE"
        chmod 600 "$AUTH_URL_CONFIG_FILE"
    elif [ -f "$AUTH_URL_CONFIG_FILE" ]; then
        AUTH_URL=$(cat "$AUTH_URL_CONFIG_FILE")
    fi
}

# Render launchd.env to stdout (scripts/launchd-env.mjs quotes every value).
# write_env_from_gui_plist copies the gui plist's env block minus PATH (the
# system plist sets PATH); write_env_from_vars writes the variables a gui plist
# would carry, from what resolve_env_from_dotenv set. Values never reach the terminal.
write_env_from_gui_plist() {
    "$NODE_PATH" "$SCRIPT_DIR/launchd-env.mjs" from-plist "$PLIST_FILE"
}
write_env_from_vars() {
    PORT="$PORT" HOSTNAME="$HOST" NODE_ENV=production DATA_DIR="$DATA_DIR" \
    NEXT_DIST_DIR="$NEXT_DIST_DIR" AUTH_TRUST_HOST=true \
    AUTH_SECRET="${AUTH_SECRET:-}" ENCRYPTION_KEY="${ENCRYPTION_KEY:-}" AUTH_URL="${AUTH_URL:-}" \
    "$NODE_PATH" "$SCRIPT_DIR/launchd-env.mjs" from-env \
        PORT HOSTNAME NODE_ENV DATA_DIR NEXT_DIST_DIR AUTH_SECRET ENCRYPTION_KEY AUTH_TRUST_HOST \
        ENABLE_BANKING_APP_ID ENABLE_BANKING_REDIRECT_URL ENABLE_BANKING_PRIVATE_KEY_FILE \
        ENABLE_BANKING_BASE_URL HA_WEBHOOK_URL AUTH_URL
}

# Print whether ENCRYPTION_KEY in the env file matches the other copies (never the values).
compare_keys() {
    local env_key other
    env_key="$(unset ENCRYPTION_KEY; set -a; . "$ENV_FILE"; printf '%s' "${ENCRYPTION_KEY:-}")"
    if [ -z "$env_key" ]; then
        echo -e "${RED}Error: $ENV_FILE has no ENCRYPTION_KEY.${NC}"; return 1
    fi
    if [ -f "$PLIST_FILE" ]; then
        other="$(/usr/bin/plutil -extract EnvironmentVariables.ENCRYPTION_KEY raw "$PLIST_FILE" 2>/dev/null || true)"
        if [ "$other" = "$env_key" ]; then echo "ENCRYPTION_KEY: matches the gui plist"
        else echo -e "${RED}ENCRYPTION_KEY: DIFFERS from the gui plist — do not cut over until resolved.${NC}"; return 1; fi
    fi
    if [ -f "$REPO_ROOT/.env" ]; then
        other="$(unset ENCRYPTION_KEY; set -a; . "$REPO_ROOT/.env"; printf '%s' "${ENCRYPTION_KEY:-}")"
        if [ -z "$other" ]; then echo "ENCRYPTION_KEY: not set in ~/sampolio/.env"
        elif [ "$other" = "$env_key" ]; then echo "ENCRYPTION_KEY: matches ~/sampolio/.env"
        else echo -e "${YELLOW}ENCRYPTION_KEY: differs from ~/sampolio/.env — check which one prod really uses.${NC}"; fi
    fi
}

install_system() {
    local tmp owner mode me group state
    me="$(id -un)"; group="$(id -gn)"

    # --- 1. launchd.env ------------------------------------------------------
    if [ -e "$ENV_FILE" ]; then
        [ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || { echo -e "${RED}Error: $ENV_FILE is not a regular file.${NC}"; exit 1; }
        read -r owner mode < <(stat -f '%u %Lp' "$ENV_FILE")
        [ "$owner" = "$(id -u)" ] || { echo -e "${RED}Error: $ENV_FILE is owned by uid $owner, not $(id -u).${NC}"; exit 1; }
        [ "$mode" = 600 ] || chmod 600 "$ENV_FILE"
        echo "Env file:     $ENV_FILE (existing, kept as-is; delete it to regenerate)"
    else
        mkdir -p "$(dirname "$ENV_FILE")"
        tmp="$(umask 077; mktemp "$ENV_FILE.XXXXXX")"
        if [ -f "$PLIST_FILE" ]; then
            ( umask 077; write_env_from_gui_plist > "$tmp" ) || { rm -f "$tmp"; exit 1; }
            echo "Env file:     $ENV_FILE (written from the gui plist env block)"
        else
            resolve_env_from_dotenv
            ( umask 077; write_env_from_vars > "$tmp" ) || { rm -f "$tmp"; exit 1; }
            echo "Env file:     $ENV_FILE (written from ~/sampolio/.env and the data-dir fallbacks)"
        fi
        chmod 600 "$tmp"
        mv -f "$tmp" "$ENV_FILE"
    fi
    compare_keys || exit 1

    # --- 2. staged, secret-free system plist ---------------------------------
    mkdir -p "$STAGE_DIR"; chmod 700 "$STAGE_DIR"
    tmp="$(mktemp "$STAGED_PLIST.XXXXXX")"
    cat > "$tmp" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>

    <!-- System daemon that runs as ${me}. No secrets here: launchd-run.sh
         sources ${ENV_FILE} (0600, owned by ${me}) and execs next start. -->
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${REPO_ROOT}/scripts/launchd-run.sh</string>
    </array>

    <key>UserName</key>
    <string>${me}</string>
    <key>GroupName</key>
    <string>${group}</string>

    <key>WorkingDirectory</key>
    <string>${REPO_ROOT}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>USER</key>
        <string>${me}</string>
        <key>LOGNAME</key>
        <string>${me}</string>
        <key>PATH</key>
        <string>${NODE_BIN_DIR}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>SAMPOLIO_NODE</key>
        <string>${NODE_PATH}</string>
        <key>SAMPOLIO_ENV_FILE</key>
        <string>${ENV_FILE}</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <!-- Unconditional: a SIGTERM from ${me} (scripts/prod-service.sh restart)
         must bring it back, so restarts need no sudo. -->
    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>${LOG_DIR}/sampolio.log</string>

    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/sampolio-error.log</string>

    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
EOF
    /usr/bin/plutil -lint "$tmp" >/dev/null || { rm -f "$tmp"; exit 1; }
    chmod 600 "$tmp"
    mv -f "$tmp" "$STAGED_PLIST"
    echo "Staged plist: $STAGED_PLIST (no secrets)"
    echo ""

    # --- 3. the sudo steps ----------------------------------------------------
    if launchctl print "gui/$(id -u)/${PLIST_NAME}" >/dev/null 2>&1; then state=cutover
    elif launchctl print "system/${PLIST_NAME}" >/dev/null 2>&1; then state=update
    else state=fresh; fi

    echo -e "${GREEN}=== Prepared. Nothing was installed or restarted. ===${NC}"
    echo ""
    case "$state" in
        cutover)
            echo "The gui agent is running. To cut over (as root, in one go):"
            cat << EOF
  launchctl bootout gui/$(id -u)/${PLIST_NAME}
  sudo -u ${me} mkdir -p $HOME/Library/LaunchAgents.disabled
  sudo -u ${me} mv $PLIST_FILE $HOME/Library/LaunchAgents.disabled/
  install -o root -g wheel -m 600 $STAGED_PLIST $SYSTEM_PLIST
  launchctl bootstrap system $SYSTEM_PLIST
EOF
            ;;
        update)
            echo "The system daemon is loaded. To apply the re-rendered plist (as root):"
            cat << EOF
  install -o root -g wheel -m 600 $STAGED_PLIST $SYSTEM_PLIST
  launchctl bootout system/${PLIST_NAME}
  launchctl bootstrap system $SYSTEM_PLIST
EOF
            ;;
        fresh)
            echo "No job is loaded. To install (as root):"
            cat << EOF
  install -o root -g wheel -m 600 $STAGED_PLIST $SYSTEM_PLIST
  launchctl bootstrap system $SYSTEM_PLIST
EOF
            ;;
    esac
    echo ""
    echo "Then: ./scripts/prod-service.sh status   (restart without sudo: ./scripts/prod-service.sh restart)"
    echo "A bootstrap right after a bootout can fail with '5: Input/output error'; retry it."
}

if [ "$DOMAIN" = system ]; then
    install_system
    exit 0
fi

# Check if already installed
if [ -f "$PLIST_FILE" ]; then
    echo -e "${YELLOW}Existing installation found. Updating...${NC}"
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
fi

resolve_env_from_dotenv

# Create the LaunchAgents directory if it doesn't exist
mkdir -p "$HOME/Library/LaunchAgents"

# Create the plist file. It embeds AUTH_SECRET and ENCRYPTION_KEY, so it is
# written under umask 077 and kept owner-only (0600); launchd loads 0600 user
# LaunchAgents fine (it only refuses group/world-WRITABLE plists).
( umask 077; cat > "$PLIST_FILE" ) << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${REPO_ROOT}/node_modules/next/dist/bin/next</string>
        <string>start</string>
        <string>-p</string>
        <string>${PORT}</string>
        <string>-H</string>
        <string>${HOST}</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${REPO_ROOT}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${NODE_BIN_DIR}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>PORT</key>
        <string>${PORT}</string>
        <key>HOSTNAME</key>
        <string>${HOST}</string>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>DATA_DIR</key>
        <string>${DATA_DIR}</string>
        <key>NEXT_DIST_DIR</key>
        <string>${NEXT_DIST_DIR}</string>
        <key>AUTH_SECRET</key>
        <string>${AUTH_SECRET}</string>
        <key>ENCRYPTION_KEY</key>
        <string>${ENCRYPTION_KEY}</string>
        <key>AUTH_TRUST_HOST</key>
        <string>true</string>${ENABLE_BANKING_APP_ID:+
        <key>ENABLE_BANKING_APP_ID</key>
        <string>${ENABLE_BANKING_APP_ID}</string>}${ENABLE_BANKING_REDIRECT_URL:+
        <key>ENABLE_BANKING_REDIRECT_URL</key>
        <string>${ENABLE_BANKING_REDIRECT_URL}</string>}${ENABLE_BANKING_PRIVATE_KEY_FILE:+
        <key>ENABLE_BANKING_PRIVATE_KEY_FILE</key>
        <string>${ENABLE_BANKING_PRIVATE_KEY_FILE}</string>}${ENABLE_BANKING_BASE_URL:+
        <key>ENABLE_BANKING_BASE_URL</key>
        <string>${ENABLE_BANKING_BASE_URL}</string>}${HA_WEBHOOK_URL:+
        <key>HA_WEBHOOK_URL</key>
        <string>${HA_WEBHOOK_URL}</string>}${AUTH_URL:+
        <key>AUTH_URL</key>
        <string>${AUTH_URL}</string>}
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>StandardOutPath</key>
    <string>${LOG_DIR}/sampolio.log</string>

    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/sampolio-error.log</string>

    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
EOF

# Owner-only: covers a pre-existing plist that `cat >` kept at its old mode.
chmod 600 "$PLIST_FILE"

# Load the launch agent
launchctl load "$PLIST_FILE"

echo -e "${GREEN}=== Installation Complete! ===${NC}"
echo ""
echo "Sampolio has been installed and is now running!"
echo ""
echo "  Web Interface: http://${HOST}:${PORT}"
echo "  Logs:          $LOG_DIR/sampolio.log"
echo "  Data:          $DATA_DIR"
echo ""
echo "The app will automatically start when you log in."
echo ""
echo "To check status:   launchctl list | grep sampolio"
echo "To stop:           launchctl unload $PLIST_FILE"
echo "To start:          launchctl load $PLIST_FILE"
echo "To uninstall:      ./scripts/uninstall-launchd.sh"
