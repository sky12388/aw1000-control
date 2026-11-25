#!/bin/sh
# ==============================================================================
# AW1000 Control — 1-Command Router Installer (OpenWrt / AW1000 Ultra 5G)
#
# HARD SAFETY GUARANTEE:
#   NEVER modifies SSH (dropbear), NetBird, Tailscale, or /etc/firewall.user.
#   Always creates /etc/config/rpcd.pre-pwa.bak before registering the 'pwa'
#   least-privilege rpcd account.
#
# Usage on the AW1000 router:
#   Option A (from local tarball):
#     sh install.sh /tmp/aw1000-control-router-v1.0.13.tar.gz
#   Option B (from GitHub Release URL):
#     TAR_URL="https://github.com/sky12388/aw1000-control/releases/latest/download/aw1000-control-router-v1.0.13.tar.gz" sh install.sh
# ==============================================================================
set -e

TARBALL="${1:-}"
TMP_TAR="/tmp/aw1000-control-router.tar.gz"

echo "=== AW1000 Control Router Installer (v1.0.13) ==="

if [ -n "$TARBALL" ] && [ -f "$TARBALL" ]; then
    SRC="$TARBALL"
elif [ -n "${TAR_URL:-}" ]; then
    echo "Downloading $TAR_URL ..."
    curl -fsSL "$TAR_URL" -o "$TMP_TAR" 2>/dev/null || wget -qO "$TMP_TAR" "$TAR_URL" 2>/dev/null || wget --no-check-certificate -qO "$TMP_TAR" "$TAR_URL"
    SRC="$TMP_TAR"
else
    echo "Error: Pass the path to aw1000-control-router-*.tar.gz as argument 1, or set TAR_URL."
    exit 1
fi

echo "[1/4] Backing up /etc/config/rpcd..."
if [ -f /etc/config/rpcd ]; then
    [ -f /etc/config/rpcd.pre-pwa.bak ] || cp -p /etc/config/rpcd /etc/config/rpcd.pre-pwa.bak
    cp -p /etc/config/rpcd /etc/config/rpcd.bak
fi

echo "[2/4] Extracting PWA (/www/app), CGI gateway (/www/cgi-bin/ubus), and rpcd plugin..."
tar -C / -xzf "$SRC"
chown -R root:root /www/app /www/cgi-bin/ubus /usr/libexec/rpcd/aw1000 /usr/libexec/rpcd/aw1000-svc /usr/share/rpcd/acl.d/aw1000-pwa.json /usr/bin/aw1000-telemetry /usr/bin/aw1000-ctl /usr/bin/aw1000-led-fx 2>/dev/null || true
chmod 755 /www/app /www/cgi-bin/ubus /usr/libexec/rpcd/aw1000 /usr/bin/aw1000-telemetry /usr/bin/aw1000-ctl
[ -f /usr/libexec/rpcd/aw1000-svc ] && chmod 755 /usr/libexec/rpcd/aw1000-svc || true
[ -f /usr/bin/aw1000-led-fx ] && chmod 755 /usr/bin/aw1000-led-fx || true
[ -f /usr/bin/aw1000-rf-autopilot ] && chmod 755 /usr/bin/aw1000-rf-autopilot || true
[ -f /etc/init.d/aw1000-rf-autopilot ] && chmod 755 /etc/init.d/aw1000-rf-autopilot || true
chmod 644 /www/app/* /usr/share/rpcd/acl.d/aw1000-pwa.json

echo "[3/4] Registering least-privilege 'pwa' rpcd account..."
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

echo "[4/4] Restarting rpcd and verifying ubus..."
/etc/init.d/rpcd restart
i=0
while [ "$i" -lt 8 ]; do
    ubus -v list aw1000 >/dev/null 2>&1 && break
    i=$((i + 1))
    sleep 1
done
ubus -v list aw1000

rm -f "$TMP_TAR"
echo "=============================================================="
echo " AW1000 Control v1.0.13 installed successfully!"
echo " Open on LAN : https://192.168.1.1/app/"
echo " Or install AW1000-Control-v1.0.13.apk on your Android phone."
echo "=============================================================="
