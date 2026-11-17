#!/usr/bin/env bash
# Builds the release APK from the version in pubspec.yaml and publishes it
# through the server's release CLI, which verifies the APK (aapt, apksigner),
# stores it at /download/releases/longbow-<versionCode>.apk and announces it.
#
# Usage: scripts/publish.sh <notes-file> [title]
#
# Every release needs a strictly higher build number than the last one
# (the +N in pubspec.yaml `version: x.y.z+N`): Android refuses to install an
# update whose versionCode is not newer, and the app only offers newer ones.
set -euo pipefail

cd "$(dirname "$0")/.."

notes_file="${1:-}"
title="${2:-}"
if [ -z "$notes_file" ] || [ ! -f "$notes_file" ]; then
  echo "usage: scripts/publish.sh <notes-file> [title]" >&2
  exit 1
fi

version_line=$(grep -E '^version:' pubspec.yaml | head -n1 | sed -E 's/^version:[[:space:]]*//')
if ! [[ "$version_line" =~ ^([0-9]+\.[0-9]+\.[0-9]+)\+([0-9]+)$ ]]; then
  echo "pubspec.yaml version must look like 1.0.1+2 (name+build), got: $version_line" >&2
  exit 1
fi
build_name="${BASH_REMATCH[1]}"
build_number="${BASH_REMATCH[2]}"
if [ "$build_number" -lt 1 ] || [ "$build_number" -gt 2100000000 ]; then
  echo "build number $build_number is outside 1..2100000000" >&2
  exit 1
fi
[ -n "$title" ] || title="Longbow $build_name"

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

apk="build/app/outputs/flutter-apk/app-release.apk"
built_code=$(aapt dump badging "$apk" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -n1)
if [ "$built_code" != "$build_number" ]; then
  echo "built APK has versionCode '$built_code', expected $build_number" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -f "$work/release.json"; rmdir "$work"' EXIT
release_json="$work/release.json"
BUILD_ID="$build_name-$build_number" BUILD_NAME="$build_name" TITLE="$title" NOTES_FILE="$notes_file" \
  node -e '
    const fs = require("node:fs");
    const e = process.env;
    process.stdout.write(JSON.stringify({
      id: e.BUILD_ID,
      version: e.BUILD_NAME,
      title: e.TITLE,
      notes: fs.readFileSync(e.NOTES_FILE, "utf8").trim(),
      publishedAt: Date.now(),
    }));
  ' > "$release_json"

apk_abs="$(pwd)/$apk"
(cd ../server && node scripts/publish-release.ts "$release_json" "$apk_abs")
echo "published Longbow $build_name ($build_number)"
