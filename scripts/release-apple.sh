#!/bin/bash
# Signed builds of the Safari container app (apple/):
#   mac — signed with Developer ID, notarized by Apple, packed into a .dmg (no App Store);
#   ios — uploaded to App Store Connect for TestFlight (iPad, iPhone).
# Runs on a Mac with Xcode signed in to the team's Apple ID (Xcode → Settings → Accounts).
# Credentials stay in Xcode: -allowProvisioningUpdates, no passwords in this script.
# Usage: scripts/release-apple.sh mac|ios|all     (bash 3.2 compatible)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/apple/Web Pilot Sidebar.xcodeproj"
OUT="$ROOT/build/release"
TEAM="${WPS_TEAM_ID:-LXY7H5ZUE9}"   # UkrHD
WHAT="${1:-}"
case "$WHAT" in mac|ios|all) ;; *) echo "Использование: $0 mac|ios|all" >&2; exit 2 ;; esac

NODE="$(command -v node || true)"
for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do [ -n "$NODE" ] || { [ -x "$candidate" ] && NODE="$candidate"; }; done
[ -n "$NODE" ] || { echo "Не найден Node.js 22+." >&2; exit 1; }
command -v xcodebuild >/dev/null || { echo "Нужен Xcode." >&2; exit 1; }

VERSION="$("$NODE" -p "require('$ROOT/package.json').version")"
BUILD_NUMBER="$(date +%y%m%d%H%M)"   # grows with every upload, as App Store Connect requires
mkdir -p "$OUT"

echo "== Рабочая сборка расширения $VERSION ($BUILD_NUMBER)"
"$NODE" "$ROOT/scripts/build.mjs" --release --target safari

options_plist() { # options_plist file method destination
  cat > "$1" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>$2</string>
  <key>destination</key><string>$3</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
}

archive() { # archive scheme destination path
  echo "== Архив: $1"
  xcodebuild archive -project "$PROJECT" -scheme "$1" -configuration Release -destination "$2" \
    -archivePath "$3" -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM" MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
    > "$3.log" 2>&1 || { tail -n 30 "$3.log"; echo "Архив не собран, журнал: $3.log" >&2; exit 1; }
}

release_mac() {
  local archive_path="$OUT/mac-$BUILD_NUMBER.xcarchive" export_dir="$OUT/mac-$BUILD_NUMBER" app dmg stage
  archive "Web Pilot Sidebar (macOS)" "generic/platform=macOS" "$archive_path"
  options_plist "$OUT/mac-options.plist" developer-id upload
  echo "== Подпись Developer ID и отправка на нотаризацию Apple"
  xcodebuild -exportArchive -archivePath "$archive_path" -exportOptionsPlist "$OUT/mac-options.plist" \
    -exportPath "$export_dir" -allowProvisioningUpdates > "$export_dir.log" 2>&1 \
    || { tail -n 30 "$export_dir.log"; echo "Подпись или отправка не удалась, журнал: $export_dir.log" >&2; exit 1; }
  echo "== Жду ответа Apple (обычно несколько минут)"
  local tries=0
  until xcodebuild -exportNotarizedApp -archivePath "$archive_path" -exportPath "$export_dir/notarized" > "$export_dir.notary.log" 2>&1; do
    tries=$((tries + 1))
    if grep -qi 'invalid\|rejected' "$export_dir.notary.log"; then tail -n 20 "$export_dir.notary.log"; echo "Apple отклонила нотаризацию." >&2; exit 1; fi
    [ "$tries" -lt 90 ] || { tail -n 20 "$export_dir.notary.log"; echo "Нотаризация не завершилась за 45 минут." >&2; exit 1; }
    sleep 30
  done
  app="$(find "$export_dir/notarized" -maxdepth 1 -name '*.app' -print | head -n 1)"
  xcrun stapler validate "$app"
  spctl --assess --type execute --verbose=2 "$app"
  stage="$(mktemp -d)"; cp -R "$app" "$stage/"; ln -s /Applications "$stage/Applications"
  dmg="$ROOT/dist/release/Web-Pilot-Sidebar-$VERSION-$BUILD_NUMBER.dmg"
  rm -f "$dmg"
  if diskutil image create from -h >/dev/null 2>&1; then   # macOS 26+: hdiutil create is deprecated
    diskutil image create from --format UDZO --volumeName "Web Pilot Sidebar" "$stage" "$dmg" >/dev/null
  else
    hdiutil create -volname "Web Pilot Sidebar" -srcfolder "$stage" -format UDZO "$dmg" >/dev/null
  fi
  rm -rf "$stage"
  echo "Готово: $dmg"
}

release_ios() {
  local archive_path="$OUT/ios-$BUILD_NUMBER.xcarchive" export_dir="$OUT/ios-$BUILD_NUMBER"
  archive "Web Pilot Sidebar (iOS)" "generic/platform=iOS" "$archive_path"
  options_plist "$OUT/ios-options.plist" app-store-connect upload
  echo "== Загрузка в App Store Connect (TestFlight)"
  xcodebuild -exportArchive -archivePath "$archive_path" -exportOptionsPlist "$OUT/ios-options.plist" \
    -exportPath "$export_dir" -allowProvisioningUpdates > "$export_dir.log" 2>&1 \
    || { tail -n 30 "$export_dir.log"; echo "Загрузка не удалась, журнал: $export_dir.log" >&2; exit 1; }
  echo "Загружено: сборка $VERSION ($BUILD_NUMBER). Через 5–30 минут она появится в TestFlight."
}

case "$WHAT" in
  mac) release_mac ;;
  ios) release_ios ;;
  all) release_mac; release_ios ;;
esac
