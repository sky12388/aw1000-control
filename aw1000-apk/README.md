# AW1000 Control — Lightweight Native Android APK (`aw1000-apk`)

A minimal, zero-bloat native Android Kotlin `WebView` wrapper (`< 1 MB` APK size) for
the **AW1000 Control PWA** (`../aw1000-pwa/`).

## Features
- **Instant Local Asset Bootstrap + In-App Multi-Profile Router Connection:**
  Bundles the built `AW1000 Control` PWA inside `assets/www/` so the app opens
  instantaneously even when offline, probes the user's saved **Local LAN IP**
  (`192.168.1.1`) and **Remote VPN IP / Domain** (`10.6.x.x`, `100.x.x.x`,
  `*.netbird.cloud`, `*.ts.net`) in parallel (`1.5s` timeout), and connects in-place
  without browser URL copy-paste.
- **Scoped Self-Signed SSL Handling (`onReceivedSslError`):**
  Strictly trusts self-signed certificates only for the user-configured router LAN/VPN
  hosts (`AW1000Native.setAllowedHosts`) and private LAN/overlay subnets.
- **Full Web Audio & Native Haptic Support:**
  `mediaPlaybackRequiresUserGesture = false` + `VIBRATE` permission +
  `AW1000Native.vibrate(ms)` for the **Antenna Alignment Beeper**.
- **Direct Backup Archive Downloads:**
  Saves `.tar.gz` router backup archives directly into Android's `Downloads` folder.
- **Dynamic Light / Dark System Bars & Hardware Back Button:**
  Matches status bar and navigation bar colors (`#F7F8FC` Light / `#080B12` Dark) and
  handles Android's hardware back button across modals and tabs.

## Build Commands

```bash
cd aw1000-apk
./gradlew assembleRelease
```

## Output APK Locations
- `aw1000-apk/aw1000-control-release.apk`
- `aw1000-apk/app/build/outputs/apk/release/app-release.apk`

## Install via ADB
```bash
adb install -r aw1000-apk/aw1000-control-release.apk
```
