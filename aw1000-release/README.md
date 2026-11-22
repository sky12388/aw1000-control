# AW1000 Control (`v1.0.11`) — Public Release Bundle

A lightweight, RGB-accented **Progressive Web App (`/www/app/`)** and thin **Native Android WebView APK (`~644 KB`)** for managing the **Arcadyan / Telstra AW1000 Ultra 5G Router** locally (`192.168.1.1`) or remotely over any overlay VPN (NetBird, Tailscale, WireGuard, ZeroTier).

## Release Artifacts
- **`AW1000-Control-v1.0.11.apk`** — Signed Android WebView wrapper APK (`~644 KB`, minSdk 26). Loads `https://<routerHost>/app/` directly, handles self-signed HTTPS scoped strictly to your router LAN/VPN host, and supports Web Audio + hardware haptic pulses.
- **`aw1000-control_1.0.11_all.ipk`** — Standard OpenWrt `.ipk` package (`opkg install aw1000-control_1.0.11_all.ipk`).
- **`aw1000-control-router-v1.0.11.tar.gz`** + **`install.sh`** / **`uninstall.sh`** — 1-command shell installer and clean rollback script.
- **`SHA256SUMS.txt`** — SHA-256 verification checksums for all artifacts.

## Highlights
- **Read-Only by Default:** Telemetry is live immediately; write actions (Wi-Fi `.dat` edits, IMEI change with Luhn validation, TTL spoofing, 1-Tap MAC Blacklist with Anti-Lockout Guard, Modem Restart, USB Backups, Router Reboot) require unlocking **Edit Mode** via `rpcd session.login` + an **Impact Confirmation Sheet**.
- **Lifeline Safety:** Zero write permissions to SSH (`dropbear`), NetBird, Tailscale, or `/etc/firewall.user`.
- **10-Bar Vertical Signal Meter (`10%` – `100%`)** + **Web Audio Antenna Alignment Beeper** + **Estimated Tower Distance (Timing Advance)** + **Live Ping Monitor (`1.1.1.1`)**.

## Quick Install

### Option 1 — OpenWrt `.ipk` Package (Recommended)
Copy `aw1000-control_1.0.11_all.ipk` to `/tmp/` on your AW1000 router and run:
```sh
opkg install /tmp/aw1000-control_1.0.11_all.ipk
```
To uninstall:
```sh
opkg remove aw1000-control
```

### Option 2 — Tarball + `install.sh`
Copy `aw1000-control-router-v1.0.11.tar.gz` and `install.sh` to `/tmp/` on your router and run:
```sh
sh /tmp/install.sh /tmp/aw1000-control-router-v1.0.11.tar.gz
```
To rollback/uninstall:
```sh
sh /tmp/uninstall.sh
```

### Android App
Install **`AW1000-Control-v1.0.11.apk`** on your Android phone, enter your Local LAN IP (`192.168.1.1`) and optional Remote VPN IP/domain (NetBird / Tailscale / WireGuard), and connect.
