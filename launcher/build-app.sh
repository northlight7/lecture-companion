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
      launcher/Project.swift \
      launcher/SchemeHandler.swift \
  -framework AppKit \
  -framework WebKit \
  -o "$MACOS/LectureCompanion"
chmod +x "$MACOS/LectureCompanion"

# Stamp the build. The short string is what a reader sees and the bundle version
# is what an updater will compare, and both come from the commit count so they
# rise on their own, without anyone remembering to bump a number. A working tree
# with uncommitted changes is marked as such, so a build can never be mistaken
# for a commit.
BUILD="$(git rev-list --count HEAD 2>/dev/null || echo 0)"
# Source only. The built bundle is tracked, so asking git about the whole tree
# would report this very build as an uncommitted change and every version would
# read as dirty.
if [ -n "$(git status --porcelain -- launcher web/src app pyproject.toml 2>/dev/null)" ]; then
  SUFFIX="-dirty"
else
  SUFFIX=""
fi
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 0.1.$BUILD$SUFFIX" \
                        -c "Set :CFBundleVersion $BUILD" "$CONTENTS/Info.plist"

# Sign it. `LC_SIGN_IDENTITY` names a certificate in the login keychain, and ad
# hoc signing is the fallback, so the build never fails for want of a
# certificate. Signing in this order, executable then bundle, is what the
# notarization step will need later. Hardened runtime is deliberately off:
# it is a notarization requirement, and library validation would start
# inspecting the virtualenv's extension modules for no benefit yet.
IDENTITY="${LC_SIGN_IDENTITY:-}"
if [ -n "$IDENTITY" ] && security find-identity -v -p codesigning 2>/dev/null | grep -qF "$IDENTITY"; then
  codesign --force --sign "$IDENTITY" "$MACOS/LectureCompanion"
  codesign --force --sign "$IDENTITY" "$APP"
  echo "signed with $IDENTITY"
else
  codesign --force --sign - "$MACOS/LectureCompanion"
  codesign --force --sign - "$APP"
  echo "signed ad hoc"
fi

echo "Built $APP ($(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$CONTENTS/Info.plist"))"
