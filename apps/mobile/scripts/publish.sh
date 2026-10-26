#!/usr/bin/env bash
# Builds the release APK and drops it where the server serves downloads:
# GET /download/longbow.apk on the tailnet host.
set -euo pipefail

cd "$(dirname "$0")/.."

# The server list lives in hosts.local.json (gitignored): copy
# hosts.example.json and fill in your tailnet host. Without it the app has
# nothing to probe, so fail here instead of shipping a blind build.
if [ -f hosts.local.json ]; then
  defines=(--dart-define-from-file=hosts.local.json)
else
  echo "hosts.local.json not found: copy hosts.example.json to hosts.local.json" >&2
  echo "and set LONGBOW_HOSTS to your tailnet host before building." >&2
  exit 1
fi

flutter build apk --release --target-platform android-arm64 "${defines[@]}"

mkdir -p "$HOME/.local/share/robinhood-harness/downloads"
cp build/app/outputs/flutter-apk/app-release.apk \
  "$HOME/.local/share/robinhood-harness/downloads/longbow.apk"

size=$(du -h "$HOME/.local/share/robinhood-harness/downloads/longbow.apk" | cut -f1)
echo "longbow.apk: $size"
