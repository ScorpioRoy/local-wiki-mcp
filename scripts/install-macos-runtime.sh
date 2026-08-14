#!/bin/sh
set -eu

ROOT=""
UNINSTALL=0
NO_START=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) ROOT=${2-}; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    --no-start) NO_START=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$ROOT" ]; then
  echo "--root is required." >&2
  exit 2
fi

LABEL="com.local-wiki-mcp.runtime"
DOMAIN="gui/$(id -u)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST="$LAUNCH_AGENTS/$LABEL.plist"

if [ "$UNINSTALL" -eq 1 ]; then
  launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  echo "Removed the current-user local-wiki LaunchAgent."
  exit 0
fi

NODE=$(command -v node)
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLI=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)/src/cli.js
ROOT=$(CDPATH= cd -- "$ROOT" && pwd)
STATE_DIR="$ROOT/.state"
LOG_FILE="$STATE_DIR/local-wiki-runtime.log"
mkdir -p "$LAUNCH_AGENTS" "$STATE_DIR"

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

NODE_XML=$(xml_escape "$NODE")
CLI_XML=$(xml_escape "$CLI")
ROOT_XML=$(xml_escape "$ROOT")
LOG_XML=$(xml_escape "$LOG_FILE")
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_XML</string>
    <string>$CLI_XML</string>
    <string>daemon</string>
    <string>--root</string>
    <string>$ROOT_XML</string>
    <string>--watch</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT_XML</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_XML</string>
  <key>StandardErrorPath</key>
  <string>$LOG_XML</string>
</dict>
</plist>
EOF
chmod 600 "$PLIST"
echo "Installed the current-user LaunchAgent: $PLIST"

if [ "$NO_START" -eq 0 ]; then
  launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "$DOMAIN" "$PLIST"
  launchctl kickstart -k "$DOMAIN/$LABEL"
  echo "Started the local-wiki runtime."
fi
