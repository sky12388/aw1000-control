#!/bin/bash
# ==============================================================================
# AW1000 Control — Public Release Packager (v1.0.4)
# Builds:
#   1. AW1000-Control-v1.0.4.apk
#   2. aw1000-control-router-v1.0.4.tar.gz
#   3. aw1000-control_1.0.4_all.ipk  (Standard OpenWrt opkg package)
#   4. SHA256SUMS.txt
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PWA_DIR="$ROOT/aw1000-pwa"
APK_DIR="$ROOT/aw1000-apk"
REL_DIR="$ROOT/aw1000-release"
WORK="/tmp/aw1000-release-build"
if [ -f "$APK_DIR/VERSION" ]; then
  # shellcheck source=/dev/null
  . "$APK_DIR/VERSION"
fi
VERSION="${VERSION_NAME:-1.0.5}"

rm -rf "$WORK"
mkdir -p "$WORK/data/www/app" \
         "$WORK/data/www/cgi-bin" \
         "$WORK/data/usr/libexec/rpcd" \
         "$WORK/data/usr/share/rpcd/acl.d" \
         "$WORK/data/usr/bin" \
         "$WORK/control" \
         "$WORK/ipk"

echo "[1/5] Building PWA (v14) and verifying JS syntax..."
npm --prefix "$PWA_DIR" run build
node --check "$PWA_DIR/dist/app.js"

echo "[2/5] Checking public Android APK (v$VERSION)..."
if [ -x "$APK_DIR/gradlew" ] && [ "${SKIP_APK_BUILD:-0}" != "1" ]; then
  "$APK_DIR/gradlew" -p "$APK_DIR" assembleRelease
  cp -f "$APK_DIR/aw1000-control-release.apk" "$REL_DIR/AW1000-Control-v${VERSION}.apk"
elif [ -f "$APK_DIR/aw1000-control-release.apk" ]; then
  cp -f "$APK_DIR/aw1000-control-release.apk" "$REL_DIR/AW1000-Control-v${VERSION}.apk"
fi

echo "[3/5] Staging router payload (zero personal secrets or IPs)..."
cp "$PWA_DIR/dist/index.html" \
   "$PWA_DIR/dist/app.js" \
   "$PWA_DIR/dist/styles.css" \
   "$PWA_DIR/dist/icon.svg" \
   "$PWA_DIR/dist/manifest.webmanifest" \
   "$PWA_DIR/dist/sw.js" \
   "$WORK/data/www/app/"

cp "$PWA_DIR/rpcd/aw1000-cgi-ubus" "$WORK/data/www/cgi-bin/ubus"
cp "$PWA_DIR/rpcd/aw1000" "$WORK/data/usr/libexec/rpcd/aw1000"
cp "$PWA_DIR/rpcd/aw1000-svc" "$WORK/data/usr/libexec/rpcd/aw1000-svc"
cp "$PWA_DIR/rpcd/aw1000-pwa.json" "$WORK/data/usr/share/rpcd/acl.d/aw1000-pwa.json"
cp "$ROOT/router/aw1000-telemetry" "$WORK/data/usr/bin/aw1000-telemetry"
cp "$ROOT/router/aw1000-ctl" "$WORK/data/usr/bin/aw1000-ctl"
cp "$ROOT/router/aw1000-led-fx" "$WORK/data/usr/bin/aw1000-led-fx"

chmod 755 "$WORK/data/www/cgi-bin/ubus" \
          "$WORK/data/usr/libexec/rpcd/aw1000" \
          "$WORK/data/usr/libexec/rpcd/aw1000-svc" \
          "$WORK/data/usr/bin/aw1000-telemetry" \
          "$WORK/data/usr/bin/aw1000-ctl" \
          "$WORK/data/usr/bin/aw1000-led-fx"
chmod 644 "$WORK/data/usr/share/rpcd/acl.d/aw1000-pwa.json"
find "$WORK/data" -type d -exec chmod 755 {} +
find "$WORK/data/www/app" -type f -exec chmod 644 {} +

# 1. Router tarball for install.sh
tar -C "$WORK/data" --owner=0 --group=0 -czf "$REL_DIR/aw1000-control-router-v${VERSION}.tar.gz" www usr

echo "[4/5] Building OpenWrt .ipk package (aw1000-control_${VERSION}_all.ipk)..."
INSTALLED_SIZE=$(du -sk "$WORK/data" | awk '{print $1}')

cat > "$WORK/control/control" <<EOF
Package: aw1000-control
Version: ${VERSION}
Architecture: all
Maintainer: AW1000 Community
Section: luci
Priority: optional
Depends: uhttpd, rpcd, lua, luci-lib-jsonc
Installed-Size: ${INSTALLED_SIZE}
Description: Lightweight RGB-accented PWA (/www/app/) and least-privilege rpcd backend for the AW1000 Ultra 5G router. Never modifies SSH, NetBird, Tailscale, or /etc/firewall.user.
EOF

cat > "$WORK/control/postinst" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0
[ -f /etc/config/rpcd.pre-pwa.bak ] || cp -p /etc/config/rpcd /etc/config/rpcd.pre-pwa.bak
uci set rpcd.pwa=login
uci set rpcd.pwa.username="pwa"
uci set rpcd.pwa.password="\$p\$root"
uci -q delete rpcd.pwa.read || true
uci add_list rpcd.pwa.read="aw1000-pwa-readonly"
uci -q delete rpcd.pwa.write || true
uci add_list rpcd.pwa.write="aw1000-pwa-write"
uci commit rpcd
if [ "$(uci -q get uhttpd.main.rfc1918_filter)" != "0" ]; then
  uci set uhttpd.main.rfc1918_filter="0"
  uci commit uhttpd
  /etc/init.d/uhttpd reload >/dev/null 2>&1 || true
fi
/etc/init.d/rpcd restart >/dev/null 2>&1 || true
exit 0
EOF

cat > "$WORK/control/prerm" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0
if [ -f /etc/config/rpcd.pre-pwa.bak ]; then
  cp -p /etc/config/rpcd.pre-pwa.bak /etc/config/rpcd
else
  uci -q delete rpcd.pwa || true
  uci commit rpcd
fi
/etc/init.d/rpcd restart >/dev/null 2>&1 || true
exit 0
EOF

chmod 755 "$WORK/control/postinst" "$WORK/control/prerm"
chmod 644 "$WORK/control/control"

printf "2.0\n" > "$WORK/ipk/debian-binary"
tar -C "$WORK/control" --owner=0 --group=0 -czf "$WORK/ipk/control.tar.gz" ./control ./postinst ./prerm
tar -C "$WORK/data" --owner=0 --group=0 -czf "$WORK/ipk/data.tar.gz" .
tar -C "$WORK/ipk" --owner=0 --group=0 -czf "$REL_DIR/aw1000-control_${VERSION}_all.ipk" ./debian-binary ./control.tar.gz ./data.tar.gz

echo "[5/5] Generating SHA256SUMS.txt..."
chmod 755 "$REL_DIR/install.sh" "$REL_DIR/uninstall.sh"
(
  cd "$REL_DIR"
  sha256sum \
    "AW1000-Control-v${VERSION}.apk" \
    "aw1000-control_${VERSION}_all.ipk" \
    "aw1000-control-router-v${VERSION}.tar.gz" \
    "install.sh" \
    "uninstall.sh" > SHA256SUMS.txt
)

echo "=============================================================="
echo " AW1000 Control v${VERSION} — Public Release Bundle Ready"
echo "=============================================================="
ls -lh "$REL_DIR"
echo "--------------------------------------------------------------"
cat "$REL_DIR/SHA256SUMS.txt"
echo "=============================================================="
