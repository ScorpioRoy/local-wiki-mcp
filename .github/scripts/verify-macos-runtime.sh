#!/bin/sh
set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  echo "macOS runtime verification requires Darwin." >&2
  exit 2
fi

TEMP_BASE=${TMPDIR:-/tmp}
TEMP_BASE=${TEMP_BASE%/}
KNOWLEDGE_ROOT=$(mktemp -d "$TEMP_BASE/local-wiki-runtime-ci.XXXXXX")
LABEL="com.local-wiki-mcp.runtime"
DOMAIN="gui/$(id -u)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

cleanup() {
  node src/cli.js runtime uninstall --root "$KNOWLEDGE_ROOT" >/dev/null 2>&1 || true
  case "$KNOWLEDGE_ROOT" in
    "$TEMP_BASE"/local-wiki-runtime-ci.*)
      rm -rf -- "$KNOWLEDGE_ROOT"
      ;;
    *)
      echo "Refusing to remove unexpected CI directory: $KNOWLEDGE_ROOT" >&2
      ;;
  esac
}
trap cleanup EXIT INT TERM

node src/cli.js init --root "$KNOWLEDGE_ROOT" --template minimal >/dev/null
node src/cli.js sync --root "$KNOWLEDGE_ROOT" >/dev/null
node src/cli.js runtime install --root "$KNOWLEDGE_ROOT" >/dev/null

READY=0
ATTEMPT=0
while [ "$ATTEMPT" -lt 20 ]; do
  if node src/cli.js runtime status --root "$KNOWLEDGE_ROOT" | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      const report = JSON.parse(input);
      if (!report.active || !report.reachable) process.exit(1);
    });
  '; then
    READY=1
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "LaunchAgent did not become reachable." >&2
  exit 1
fi

launchctl print "$DOMAIN/$LABEL" >/dev/null
node src/cli.js smoke --root "$KNOWLEDGE_ROOT" >/dev/null
node src/cli.js runtime uninstall --root "$KNOWLEDGE_ROOT" >/dev/null
if [ -e "$PLIST" ]; then
  echo "LaunchAgent plist still exists after uninstall: $PLIST" >&2
  exit 1
fi

echo "macOS LaunchAgent install, reachability, smoke, and uninstall verification passed."
