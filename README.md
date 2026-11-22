# AW1000 Control (`v1.0.4`)

Lightweight, RGB-accented **OpenWrt Progressive Web App (`/www/app/`)** and **645 KB Native Android WebView Companion APK** for managing the **Arcadyan / Telstra AW1000 Ultra 5G Router** locally (`192.168.1.1`) or remotely over NetBird, Tailscale, WireGuard, or ZeroTier.

- **Landing Page & Downloads:** `https://sky12388.github.io/aw1000-control/`
- **GitHub Releases:** `https://github.com/sky12388/aw1000-control/releases`

## Repository Structure
- [`aw1000-pwa/`](aw1000-pwa/) — Zero-dependency Progressive Web App (`~33.5 KB` gzipped JS, `~6.4 KB` gzipped CSS) + `rpcd` ACL (`aw1000-pwa.json`), `rpcd` helper (`aw1000`), and native Lua JSON-RPC gateway (`aw1000-cgi-ubus`).
- [`aw1000-apk/`](aw1000-apk/) — Thin native Android Kotlin WebView shell (`~645 KB` APK) with scoped self-signed HTTPS handling, dark `#0B1120` status bar, Web Audio + hardware haptic pulses, and direct `.tar.gz` backup downloads.
- [`aw1000-web/`](aw1000-web/) — Static public landing website deployed automatically to GitHub Pages via `.github/workflows/deploy-pages.yml`.
- [`aw1000-release/`](aw1000-release/) — 1-command router installer (`install.sh`), uninstaller (`uninstall.sh`), and OpenWrt `.ipk` / `.tar.gz` release packager (`build-release.sh`).
- [`router/`](router/) — Read-only telemetry (`aw1000-telemetry`) and router control helper (`aw1000-ctl`) scripts for OpenWrt on the AW1000 Ultra.

## Safety Architecture
- **Read-Only by Default:** All write controls remain disabled until the user unlocks **Edit Mode** (authenticated via `rpcd session.login`) and confirms via an **Impact Confirmation Sheet**.
- **Lifeline Protection:** Zero write permissions to SSH (`dropbear`), NetBird, Tailscale, or `/etc/firewall.user`.
- **Automatic Backups:** Backs up `/etc/config/rpcd`, `/etc/wireless/mediatek/mt7915.{1,2}.dat`, `/etc/config/3ginfo_ttl`, and previous IMEI values before any write.

## Installation

### 1‑command `.tar.gz` installer (works even if ISP DNS is broken)

\`\`\`bash
nslookup github.com >/dev/null 2>&1 || echo "nameserver 1.1.1.1" > /tmp/resolv.conf.auto;
wget --no-check-certificate -O /tmp/aw1000-control-router-v1.0.9.tar.gz https://github.com/sky12388/aw1000-control/releases/download/v1.0.9/aw1000-control-router-v1.0.9.tar.gz && wget --no-check-certificate -O /tmp/install.sh https://github.com/sky12388/aw1000-control/releases/download/v1.0.9/install.sh && sh /tmp/install.sh /tmp/aw1000-control-router-v1.0.9.tar.gz
\`\`\`

### OpenWrt `opkg` installer

\`\`\`bash
nslookup github.com >/dev/null 2>&1 || echo "nameserver 1.1.1.1" > /tmp/resolv.conf.auto;
wget --no-check-certificate -O /tmp/aw1000-control_1.0.9_all.ipk https://github.com/sky12388/aw1000-control/releases/download/v1.0.9/aw1000-control_1.0.9_all.ipk && opkg install /tmp/aw1000-control_1.0.9_all.ipk
\`\`\`
