#!/usr/bin/env bash
# Builds the release APK and drops it where the server serves downloads:
# GET /download/longbow.apk on the tailnet host.
set -euo pipefail

cd "$(dirname "$0")/.."

flutter build apk --release

mkdir -p "$HOME/.local/share/robinhood-harness/downloads"
cp build/app/outputs/flutter-apk/app-release.apk \
  "$HOME/.local/share/robinhood-harness/downloads/longbow.apk"

size=$(du -h "$HOME/.local/share/robinhood-harness/downloads/longbow.apk" | cut -f1)
echo "longbow.apk: $size"
