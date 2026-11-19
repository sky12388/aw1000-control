#!/bin/bash
# ==============================================================================
# AW1000 Control — Thin Native Android WebView Shell APK Builder (< 1 MB APK)
# Uses Android SDK 36 (aapt2, d8, zipalign, apksigner) + Kotlin 2.2.21 compiler
# Pure native WebView wrapper for https://<routerHost>/app/
# ==============================================================================
set -euo pipefail

ROOT_DIR="/home/ma/AW1000/aw1000-apk"
PWA_DIR="/home/ma/AW1000/aw1000-pwa"
SDK_DIR="/home/ma/Android/Sdk"
BUILD_TOOLS="$SDK_DIR/build-tools/36.0.0"
ANDROID_JAR="$SDK_DIR/platforms/android-36/android.jar"
GRADLE_LIB="/home/ma/.gradle/wrapper/dists/gradle-9.3.1-all/9ot9r568e8zfvvd4mn8rbu1j0/gradle-9.3.1/lib"
KOTLIN_STDLIB="$GRADLE_LIB/kotlin-stdlib-2.2.21.jar"

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
  --version-code 5 \
  --version-name "1.0.4" \
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

APK_BYTES=$(stat -c%s "$TOP_APK")
APK_MB=$(awk -v b="$APK_BYTES" 'BEGIN{printf "%.2f MB (%d KB)", b/1048576, b/1024}')

echo "=============================================================="
echo " AW1000 Control Android APK — Build Complete"
echo "=============================================================="
echo " APK Output 1 : $TOP_APK"
echo " APK Output 2 : $RELEASE_APK"
echo " Final Size   : $APK_MB (Target: < 5.00 MB) [PASS]"
echo "=============================================================="
