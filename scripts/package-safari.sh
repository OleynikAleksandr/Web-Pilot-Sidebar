#!/bin/sh
# Wraps dist/safari into an Xcode project: one container app for macOS and
# iOS/iPadOS. Runs on a Mac with Xcode. Extra arguments go to the Apple tool.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIST="$ROOT/dist/safari"
OUT="$ROOT/build/safari-xcode"
APP_NAME="Web Pilot Sidebar"
BUNDLE_ID="${WPS_BUNDLE_ID:-com.oleynik.WebPilotSidebar}"

if [ ! -f "$DIST/manifest.json" ]; then
  echo "Нет сборки Safari. Сначала выполните: npm run build" >&2
  exit 1
fi
if ! command -v xcrun >/dev/null 2>&1; then
  echo "Нужен Xcode (xcrun). Запускайте на Mac." >&2
  exit 1
fi

mkdir -p "$OUT"

if xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  # The project references dist/safari in place: after npm run build just rebuild in Xcode.
  xcrun safari-web-extension-converter "$DIST" \
    --project-location "$OUT" --app-name "$APP_NAME" --bundle-identifier "$BUNDLE_ID" \
    --swift --no-open --force "$@"
elif xcrun --find safari-web-extension-packager >/dev/null 2>&1; then
  # Newer Xcode: resources are copied into the project, so re-run this script after npm run build.
  (cd "$OUT" && xcrun safari-web-extension-packager --copy-resources "$DIST" "$@")
else
  echo "В этой версии Xcode не найден ни safari-web-extension-converter, ни safari-web-extension-packager." >&2
  exit 1
fi

echo
echo "Проект Xcode: $OUT"
echo "Дальше: откройте его в Xcode, в Signing & Capabilities выберите свою команду для приложения и расширения,"
echo "запустите схему macOS (Safari на Mac) или iOS (iPad/iPhone). Подробно — docs/planning/stage-0-feasibility.md."
