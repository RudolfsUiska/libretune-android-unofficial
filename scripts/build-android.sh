#!/usr/bin/env bash
# Build (and optionally install) the LibreTune (unofficial Android port) APK on Windows (Git Bash).
#
#   scripts/build-android.sh [--release] [--install]
#
# Needs: Rust with the aarch64-linux-android target, Node.js, a JDK 17, and the
# Android SDK with NDK 27 and build-tools. Point the script at them with:
#   JAVA_HOME (or JAVA_HOME_17)  a JDK 17 (the Gradle build fails on JDK 8)
#   ANDROID_HOME                 the Android SDK
#   NDK_HOME                     optional, defaults to $ANDROID_HOME/ndk/27.2.12479018
#   ADB                          optional, defaults to adb on PATH
#   CARGO_TARGET_DIR             optional, shared Rust build directory
# For --release, set KEYSTORE and KEYSTORE_PASS to sign the APK (keytool can
# make a keystore); without them you get the unsigned APK.
#
# `tauri android build` compiles the Rust library, then tries to *symlink* it
# into jniLibs, which Windows refuses unless Developer Mode is on. This script
# lets that step fail, copies the library in (stripped - a debug build is
# ~600 MB of DWARF), and runs Gradle with the Rust task skipped.
set -euo pipefail

PROFILE=debug
INSTALL=0
for a in "$@"; do
  case "$a" in
    --release) PROFILE=release ;;
    --install) INSTALL=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/crates/libretune-app"
ANDROID_DIR="$APP/src-tauri/gen/android"

export JAVA_HOME="${JAVA_HOME_17:-${JAVA_HOME:?set JAVA_HOME (or JAVA_HOME_17) to a JDK 17}}"
export ANDROID_HOME="${ANDROID_HOME:?set ANDROID_HOME to the Android SDK}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/27.2.12479018}"
export PATH="$HOME/.cargo/bin:$(cygpath -u "$JAVA_HOME")/bin:$PATH"
ADB="${ADB:-adb}"
STRIP="$(cygpath -u "$NDK_HOME")/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe"
TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

flags=(--apk true --target aarch64)
[ "$PROFILE" = debug ] && flags+=(--debug)

cd "$APP"
# Expected to fail at the symlink step on Windows; the library is built by then.
npx tauri android build "${flags[@]}" || true

SO="$TARGET_DIR/aarch64-linux-android/$PROFILE/liblibretune_app_lib.so"
DEST="$ANDROID_DIR/app/src/main/jniLibs/arm64-v8a"
[ -f "$SO" ] || { echo "Rust library not built: $SO" >&2; exit 1; }
mkdir -p "$DEST"
rm -f "$DEST/liblibretune_app_lib.so"
"$STRIP" --strip-debug -o "$DEST/liblibretune_app_lib.so" "$SO"

Cap=$([ "$PROFILE" = debug ] && echo Debug || echo Release)
OUT="$ANDROID_DIR/app/build/outputs/apk/arm64/$PROFILE"
cd "$ANDROID_DIR"
# Gradle rewrites the APK in place and leaves the replaced 140 MB library as
# dead space inside the zip, doubling the file; always package from scratch.
rm -f "$OUT"/*.apk
./gradlew.bat "assembleArm64$Cap" -x "rustBuildArm64$Cap" --console=plain -q

APK="$(ls -t "$OUT"/*.apk | head -1)"
if [ "$PROFILE" = release ] && [ -n "${KEYSTORE:-}" ]; then
  BT="$(ls -d "$(cygpath -u "$ANDROID_HOME")"/build-tools/* | sort -V | tail -1)"
  ALIGNED="$OUT/app-arm64-release-aligned.apk"
  SIGNED="$OUT/app-arm64-release.apk"
  "$BT/zipalign.exe" -f -p 4 "$APK" "$ALIGNED"
  "$BT/apksigner.bat" sign --ks "$KEYSTORE" --ks-pass env:KEYSTORE_PASS --out "$SIGNED" "$ALIGNED"
  rm -f "$ALIGNED"
  APK="$SIGNED"
fi
echo "APK: $APK ($(du -h "$APK" | cut -f1))"

if [ "$INSTALL" = 1 ]; then
  "$ADB" install -r "$APK"
  "$ADB" shell am start -n com.libretune.app/com.libretune.app.MainActivity
fi
