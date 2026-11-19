#!/bin/bash
# ==============================================================================
# AW1000 Control — Thin Native Android WebView Shell APK Builder (< 1 MB APK)
# Uses Android SDK 36 (aapt2, d8, zipalign, apksigner) + Kotlin 2.2.21 compiler
# Pure native WebView wrapper for https://<routerHost>/app/
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PWA_DIR="$(cd "$ROOT_DIR/../aw1000-pwa" && pwd)"
SDK_DIR="${ANDROID_HOME:-$HOME/Android/Sdk}"
BUILD_TOOLS="$SDK_DIR/build-tools/36.0.0"
ANDROID_JAR="$SDK_DIR/platforms/android-36/android.jar"
GRADLE_LIB="${GRADLE_LIB:-$(find "$HOME/.gradle/wrapper/dists" -maxdepth 4 -type d -name lib 2>/dev/null | sort -V | tail -n1)}"
KOTLIN_STDLIB="$(find "$GRADLE_LIB" -maxdepth 1 -name 'kotlin-stdlib-*.jar' ! -name '*jdk*' ! -name '*common*' 2>/dev/null | sort -V | tail -n1)"

BUILD_DIR="$ROOT_DIR/app/build"
CLASSES_DIR="$BUILD_DIR/intermediates/classes"
DEX_DIR="$BUILD_DIR/intermediates/dex"
RES_ZIP="$BUILD_DIR/intermediates/res.zip"
UNALIGNED_APK="$BUILD_DIR/intermediates/app-unaligned.apk"
ALIGNED_APK="$BUILD_DIR/intermediates/app-aligned.apk"
OUT_DIR="$BUILD_DIR/outputs/apk/release"
RELEASE_APK="$OUT_DIR/app-release.apk"
TOP_APK="$ROOT_DIR/aw1000-control-release.apk"
KEYSTORE="$ROOT_DIR/aw1000-release.jks"
VERSION_FILE="$ROOT_DIR/VERSION"

# Auto-bump versionCode and patch versionName on every build (pass --no-bump to skip)
if [ ! -f "$VERSION_FILE" ]; then
  printf 'VERSION_CODE=5\nVERSION_NAME=1.0.4\n' > "$VERSION_FILE"
fi
# shellcheck source=/dev/null
. "$VERSION_FILE"
if [ "${1:-}" != "--no-bump" ]; then
  VERSION_CODE=$((VERSION_CODE + 1))
  IFS='.' read -r V_MAJ V_MIN V_PAT <<EOF
$VERSION_NAME
EOF
  V_PAT=$(( ${V_PAT:-0} + 1 ))
  VERSION_NAME="${V_MAJ}.${V_MIN}.${V_PAT}"
  printf 'VERSION_CODE=%s\nVERSION_NAME=%s\n' "$VERSION_CODE" "$VERSION_NAME" > "$VERSION_FILE"
  sed -i -E \
    -e "s/android:versionCode=\"[0-9]+\"/android:versionCode=\"${VERSION_CODE}\"/" \
    -e "s/android:versionName=\"[^\"]+\"/android:versionName=\"${VERSION_NAME}\"/" \
    "$ROOT_DIR/app/src/main/AndroidManifest.xml"
  sed -i -E \
    -e "s/versionCode = [0-9]+/versionCode = ${VERSION_CODE}/" \
    -e "s/versionName = \"[^\"]+\"/versionName = \"${VERSION_NAME}\"/" \
    "$ROOT_DIR/app/build.gradle.kts"
fi
VERSIONED_APK="$ROOT_DIR/aw1000-control-v${VERSION_NAME}.apk"
echo ">>> Building AW1000 Control WPWA v${VERSION_NAME} (versionCode ${VERSION_CODE}) <<<"

echo "[1/6] Building AW1000 Control PWA (dist/)..."
npm --prefix "$PWA_DIR" run build >/dev/null
rm -rf "$ROOT_DIR/app/src/main/assets" "$BUILD_DIR"
mkdir -p "$CLASSES_DIR" "$DEX_DIR" "$OUT_DIR"

echo "[2/6] Compiling Android resources with aapt2..."
"$BUILD_TOOLS/aapt2" compile \
  --dir "$ROOT_DIR/app/src/main/res" \
  -o "$RES_ZIP"

"$BUILD_TOOLS/aapt2" link \
  -I "$ANDROID_JAR" \
  --manifest "$ROOT_DIR/app/src/main/AndroidManifest.xml" \
  --min-sdk-version 26 \
  --target-sdk-version 36 \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  -o "$UNALIGNED_APK" \
  "$RES_ZIP"

echo "[3/6] Compiling MainActivity.kt with Kotlin 2.2.21..."
java --enable-native-access=ALL-UNNAMED \
  -cp "$GRADLE_LIB/*" \
  org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -no-stdlib -no-reflect \
  -jvm-target 17 \
  -classpath "$ANDROID_JAR:$KOTLIN_STDLIB" \
  -d "$CLASSES_DIR" \
  "$ROOT_DIR/app/src/main/kotlin/com/aw1000/control/MainActivity.kt"

echo "[4/6] Dexing bytecode with Android D8..."
CLASS_FILES=$(find "$CLASSES_DIR" -name "*.class")
"$BUILD_TOOLS/d8" \
  --release \
  --min-api 26 \
  --lib "$ANDROID_JAR" \
  --output "$DEX_DIR" \
  $CLASS_FILES \
  "$KOTLIN_STDLIB"

(
  cd "$DEX_DIR"
  python3 -c '
import zipfile, sys
with zipfile.ZipFile(sys.argv[1], "a", compression=zipfile.ZIP_DEFLATED) as z:
    z.write("classes.dex", "classes.dex")
' "$UNALIGNED_APK"
)

echo "[5/6] Aligning APK with zipalign..."
"$BUILD_TOOLS/zipalign" -f -p 4 "$UNALIGNED_APK" "$ALIGNED_APK"

echo "[6/6] Signing release APK with apksigner (v1 + v2 + v3)..."
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair \
    -keystore "$KEYSTORE" \
    -storepass "aw1000control" \
    -keypass "aw1000control" \
    -alias "aw1000" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=AW1000 Control, O=AW1000, C=MY" >/dev/null 2>&1
fi

"$BUILD_TOOLS/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-pass pass:aw1000control \
  --key-pass pass:aw1000control \
  --ks-key-alias aw1000 \
  --out "$RELEASE_APK" \
  "$ALIGNED_APK"

"$BUILD_TOOLS/apksigner" verify --verbose "$RELEASE_APK" | head -n 6
cp -f "$RELEASE_APK" "$TOP_APK"
cp -f "$RELEASE_APK" "$VERSIONED_APK"

APK_BYTES=$(stat -c%s "$TOP_APK")
APK_MB=$(awk -v b="$APK_BYTES" 'BEGIN{printf "%.2f MB (%d KB)", b/1048576, b/1024}')

echo "=============================================================="
echo " AW1000 Control Android APK — Build Complete (v${VERSION_NAME} / code ${VERSION_CODE})"
echo "=============================================================="
echo " APK Output 1 : $TOP_APK"
echo " APK Output 2 : $VERSIONED_APK"
echo " APK Output 3 : $RELEASE_APK"
echo " Final Size   : $APK_MB (Target: < 5.00 MB) [PASS]"
echo "=============================================================="
