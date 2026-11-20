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
#     sh install.sh /tmp/aw1000-control-router-v1.0.7.tar.gz
#   Option B (from GitHub Release URL):
#     TAR_URL="https://github.com/sky12388/aw1000-control/releases/latest/download/aw1000-control-router-v1.0.7.tar.gz" sh install.sh
# ==============================================================================
set -e

TARBALL="${1:-}"
TMP_TAR="/tmp/aw1000-control-router.tar.gz"

echo "=== AW1000 Control Router Installer ==="

if [ -n "$TARBALL" ] && [ -f "$TARBALL" ]; then
    SRC="$TARBALL"
elif [ -n "${TAR_URL:-}" ]; then
    echo "Downloading $TAR_URL ..."
    wget -qO "$TMP_TAR" "$TAR_URL" || curl -fsSL "$TAR_URL" -o "$TMP_TAR"
    SRC="$TMP_TAR"
else
    echo "Error: Pass the path to aw1000-control-router-*.tar.gz as argument 1, or set TAR_URL."
    exit 1
fi

echo "[1/4] Backing up /etc/config/rpcd..."
[ -f /etc/config/rpcd.pre-pwa.bak ] || cp -p /etc/config/rpcd /etc/config/rpcd.pre-pwa.bak

echo "[2/4] Extracting PWA (/www/app), CGI gateway (/www/cgi-bin/ubus), and rpcd plugin..."
tar -C / -xzf "$SRC"
chown -R root:root /www/app /www/cgi-bin/ubus /usr/libexec/rpcd/aw1000 /usr/share/rpcd/acl.d/aw1000-pwa.json /usr/bin/aw1000-telemetry /usr/bin/aw1000-ctl
chmod 755 /www/app /www/cgi-bin/ubus /usr/libexec/rpcd/aw1000 /usr/bin/aw1000-telemetry /usr/bin/aw1000-ctl
chmod 644 /usr/share/rpcd/acl.d/aw1000-pwa.json

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
sleep 1
ubus -v list aw1000

rm -f "$TMP_TAR"
echo "=============================================================="
echo " AW1000 Control installed successfully!"
echo " Open on LAN : https://192.168.1.1/app/"
echo " Or install AW1000-Control-v1.0.7.apk on your Android phone."
echo "=============================================================="
