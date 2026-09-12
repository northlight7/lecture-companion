#!/usr/bin/env bash
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

APP="Lecture Companion.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

mkdir -p "$MACOS" "$RESOURCES"
cp launcher/Info.plist "$CONTENTS/Info.plist"

ICON_WORK="$(mktemp -d)"
trap 'rm -rf "$ICON_WORK"' EXIT
ICONSET="$ICON_WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for spec in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"
do
  size="${spec%% *}"
  name="${spec#* }"
  sips -z "$size" "$size" launcher/AppIcon.png --out "$ICONSET/$name" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RESOURCES/AppIcon.icns"

# The interface travels inside the bundle. It is read from here by
# `SchemeHandler`, never served, so there is no page on a port to open.
rm -rf "$RESOURCES/web"
cp -R web "$RESOURCES/web"
rm -rf "$RESOURCES/web/src" "$RESOURCES/web/node_modules"
echo "bundled the interface from web/"

swiftc launcher/LectureCompanion.swift \
      launcher/AppServer.swift \
      launcher/SchemeHandler.swift \
  -framework AppKit \
  -framework WebKit \
  -o "$MACOS/LectureCompanion"
chmod +x "$MACOS/LectureCompanion"

echo "Built $APP"
