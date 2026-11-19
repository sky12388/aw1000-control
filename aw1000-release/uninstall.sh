#!/bin/sh
# ==============================================================================
# AW1000 Control — Clean Uninstaller / Rollback Script
# Restores /etc/config/rpcd from backup and removes PWA + rpcd plugin files.
# Never touches SSH, NetBird, Tailscale, or /etc/firewall.user.
# ==============================================================================
set -e

echo "=== Removing AW1000 Control from router ==="
if [ -f /etc/config/rpcd.pre-pwa.bak ]; then
    cp -p /etc/config/rpcd.pre-pwa.bak /etc/config/rpcd
else
    uci -q delete rpcd.pwa || true
    uci commit rpcd
fi

rm -rf /www/app \
       /www/cgi-bin/ubus \
       /usr/libexec/rpcd/aw1000 \
       /usr/share/rpcd/acl.d/aw1000-pwa.json

/etc/init.d/rpcd restart
echo "AW1000 Control removed cleanly. SSH and VPN are unaffected."
