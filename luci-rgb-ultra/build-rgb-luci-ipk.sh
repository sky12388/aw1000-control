#!/bin/bash
# ==============================================================================
# Build OpenWrt opkg (.ipk) package: luci-theme-rgb-ultra_1.0.0_all.ipk
# Additive RGB Neon Dark/Light Theme + WCAG Contrast Guard for OpenWrt LuCI
# ==============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
REL_DIR="$ROOT/aw1000-release"
VERSION="1.0.0"
PKG_NAME="luci-theme-rgb-ultra"
OUT_IPK="$REL_DIR/${PKG_NAME}_${VERSION}_all.ipk"
WORK="/tmp/luci-rgb-ultra-build"

rm -rf "$WORK"
mkdir -p "$WORK/data/www/luci-static/resources" \
         "$WORK/control" \
         "$WORK/ipk"

cp "$DIR/rgb-ultra.css" "$WORK/data/www/luci-static/resources/rgb-ultra.css"
cp "$DIR/rgb-ultra.js" "$WORK/data/www/luci-static/resources/rgb-ultra.js"
find "$WORK/data" -type d -exec chmod 755 {} +
chmod 644 "$WORK/data/www/luci-static/resources/rgb-ultra.css" \
          "$WORK/data/www/luci-static/resources/rgb-ultra.js"

INSTALLED_SIZE=$(du -sk "$WORK/data" | awk '{print $1}')

cat > "$WORK/control/control" <<EOF
Package: ${PKG_NAME}
Version: ${VERSION}
Architecture: all
Maintainer: AW1000 Community
Section: luci
Priority: optional
Depends: luci-theme-bootstrap
Installed-Size: ${INSTALLED_SIZE}
Description: Additive RGB neon Dark/Light UI theme with WCAG contrast enforcement and normalized Cellular Information view for OpenWrt LuCI Bootstrap. Leaves cascade.css untouched and rolls back cleanly on uninstall.
EOF

cat > "$WORK/control/postinst" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0

HDR="/usr/lib/lua/luci/view/themes/bootstrap/header.htm"
if [ ! -f "$HDR" ]; then
  THEME=$(uci -q get luci.main.mediaurlbase 2>/dev/null | sed 's|.*/||')
  [ -n "$THEME" ] && [ -f "/usr/lib/lua/luci/view/themes/$THEME/header.htm" ] && HDR="/usr/lib/lua/luci/view/themes/$THEME/header.htm"
fi

if [ -f "$HDR" ]; then
  [ -f "${HDR}.pre-rgb-ultra.bak" ] || cp -p "$HDR" "${HDR}.pre-rgb-ultra.bak"
  if ! grep -q "rgb-ultra.css" "$HDR"; then
    awk '
      /<\/head>/ && !done {
        print "\t\t<!-- RGB-ULTRA-START -->"
        print "\t\t<link rel=\"stylesheet\" href=\"<%=resource%>/rgb-ultra.css\">"
        print "\t\t<script>(function(){var t=\x27dark\x27;try{t=localStorage.getItem(\x27rgb-theme\x27)||\x27dark\x27;}catch(e){}if(t!==\x27dark\x27&&t!==\x27light\x27)t=\x27dark\x27;document.documentElement.setAttribute(\x27data-theme\x27,t);})();</script>"
        print "\t\t<script src=\"<%=resource%>/rgb-ultra.js\"></script>"
        print "\t\t<!-- RGB-ULTRA-END -->"
        done=1
      }
      { print }
    ' "$HDR" > "${HDR}.tmp" && mv "${HDR}.tmp" "$HDR"
  fi
fi

# Optional: normalize 3ginfo-lite display title if modem view is present
MODEM_JS="/www/luci-static/resources/view/modem/3gdetail.js"
if [ -f "$MODEM_JS" ]; then
  [ -f "${MODEM_JS}.pre-rgb-ultra.bak" ] || cp -p "$MODEM_JS" "${MODEM_JS}.pre-rgb-ultra.bak"
  sed -i "s/_('3ginfo-lite')/_('Cellular Information')/g; s/_(\"3ginfo-lite\")/_(\"Cellular Information\")/g" "$MODEM_JS" 2>/dev/null || true
fi

rm -rf /tmp/luci-indexcache /tmp/luci-modulecache/ 2>/dev/null || true
echo "RGB Ultra LuCI theme installed. Hard-refresh your browser (Ctrl+F5)."
exit 0
EOF

cat > "$WORK/control/prerm" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0

for HDR in /usr/lib/lua/luci/view/themes/*/header.htm; do
  [ -f "$HDR" ] || continue
  if grep -q "RGB-ULTRA-START" "$HDR"; then
    awk '/<!-- RGB-ULTRA-START -->/{skip=1;next}/<!-- RGB-ULTRA-END -->/{skip=0;next}!skip{print}' "$HDR" > "${HDR}.tmp" && mv "${HDR}.tmp" "$HDR"
  elif [ -f "${HDR}.pre-rgb-ultra.bak" ]; then
    cp -p "${HDR}.pre-rgb-ultra.bak" "$HDR"
  fi
done

MODEM_JS="/www/luci-static/resources/view/modem/3gdetail.js"
if [ -f "${MODEM_JS}.pre-rgb-ultra.bak" ]; then
  cp -p "${MODEM_JS}.pre-rgb-ultra.bak" "$MODEM_JS"
  rm -f "${MODEM_JS}.pre-rgb-ultra.bak"
fi

rm -rf /tmp/luci-indexcache /tmp/luci-modulecache/ 2>/dev/null || true
exit 0
EOF

chmod 755 "$WORK/control/postinst" "$WORK/control/prerm"
chmod 644 "$WORK/control/control"

printf "2.0\n" > "$WORK/ipk/debian-binary"
tar -C "$WORK/control" --owner=0 --group=0 -czf "$WORK/ipk/control.tar.gz" ./control ./postinst ./prerm
tar -C "$WORK/data" --owner=0 --group=0 -czf "$WORK/ipk/data.tar.gz" .
tar -C "$WORK/ipk" --owner=0 --group=0 -czf "$OUT_IPK" ./debian-binary ./control.tar.gz ./data.tar.gz

rm -rf "$WORK"
echo "=============================================================="
echo " Built: $OUT_IPK"
ls -lh "$OUT_IPK"
sha256sum "$OUT_IPK"
echo "=============================================================="
