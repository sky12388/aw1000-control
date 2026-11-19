# Deliverable 3: Line-by-Line Documentation of `rpcd` ACL & `aw1000` Plugin

## 1. `/usr/share/rpcd/acl.d/aw1000-pwa.json` (`rpcd/aw1000-pwa.json`)

Defines the least-privilege Access Control List for the dedicated `pwa` `rpcd` account:

- **`aw1000-pwa-readonly`**:
  - Read-only telemetry permissions for `system`, `network.*`, `iwinfo`, `luci-rpc`, `service`, `log`, `ril*`, `modem_pdn`, and the `aw1000` plugin's 9 read methods:
    - `status`: Read-only check of `wt0`, `tailscale0`, and `ccmni2` IPv4 addresses.
    - `telemetry`: Calls `/usr/bin/aw1000-telemetry --full` (WAN, 5G/LTE cell, Wi-Fi, CPU/RAM/thermal, VPN status, live ICMP ping to `1.1.1.1`).
    - `static_info`: Calls `/usr/bin/aw1000-telemetry --static` (IMEI, ICCID, IMSI, Operator, Model, Firmware).
    - `modem_get`: Calls `/usr/bin/aw1000-ctl modem-get` (live TTL spoofing state, APN, bandlock/celllock).
    - `wifi_get`: Reads `SSID1`, `Channel`, `HT_BW`, `AccessPolicy0`, and `AccessControlList0` from `mt7915.{1,2}.dat`.
    - `clients`: Calls `/usr/bin/aw1000-telemetry --clients` (Wi-Fi associated stations + DHCP leases).
    - `sms_list`: Calls `/usr/bin/aw1000-ctl sms-list` (decoded PDU SMS inbox from FG360).
    - `backup_list`: Lists existing `backup-*.tar.gz` archives and free space on `/mnt/usb` or `/mnt/sda1`.
    - `logs_get`: Calls `/usr/bin/aw1000-ctl logs all 1 80` (noise-filtered system/kernel log lines).
- **`aw1000-pwa-write`**:
  - Explicitly scoped write methods (all gated in the UI behind **Edit Mode** + **Impact Confirmation Sheet**):
    - `aw1000` → `wifi_set`, `imei_set`, `ttl_set`, `mac_acl`, `modem_restart`, `backup_create`
    - `system` → `reboot`
    - `modem_pdn` → `set`
    - `modem_reset` → `reset`, `exec`
  - **Protected Lifelines:** Zero write access to `dropbear`, `netbird`, `tailscale`, `uci`, `file`, or `/etc/firewall.user`.

---

## 2. `/usr/libexec/rpcd/aw1000` (`rpcd/aw1000`)

- **Lines 26–42 (`validate_imei_luhn`)**: Server-side 15-digit Luhn checksum validator in `awk`. Rejects any malformed or non-Luhn IMEI before touching the modem.
- **Lines 45–53 (`resolve_usb_mount`)**: Dynamically locates mounted USB storage at `/mnt/usb` or `/mnt/sda1`.
- **Lines 55–97 (`list`)**: Registers all read and write methods and their JSON argument signatures with `rpcd`.
- **Lines 100–221 (Read methods)**: `status`, `telemetry`, `static_info`, `modem_get`, `wifi_get`, `clients`, `sms_list`, `backup_list`, `logs_get`.
- **Lines 223–274 (`wifi_set`)**: Validates channel (`1|6|11` or `36..161`) and `HT_BW` (`0|1`), backs up `mt7915.{1,2}.dat` to `*.<timestamp>.pwa-bak`, updates `.dat`, and triggers `wifi restart` in the background.
- **Lines 276–306 (`imei_set`)**: Validates 15-digit Luhn checksum, logs the previous IMEI to `/root/aw1000-imei-backups/imei-history.log`, writes `AT+EGMR=1,7,"<imei>"`, clears `/tmp/aw1000-tm/static.json`, and cycles only the FG360 modem radio (`AT+CFUN=4` → `AT+CFUN=1`) without rebooting the router.
- **Lines 308–323 (`ttl_set`)**: Backs up `/etc/config/3ginfo_ttl` and `/etc/firewall.d/3ginfo_ttl`, then invokes `/usr/bin/aw1000-ctl ttl-set <off|1..255>` to apply idempotent IPv4 `TTL` and IPv6 `HL` mangle rules on `POSTROUTING`.
- **Lines 325–376 (`mac_acl`)**:
  - **Server-side Anti-Lockout Guard:** Looks up the caller's IP (`client_ip` / `REMOTE_ADDR`) in `ip neigh` and refuses to block the caller's own MAC address.
  - Creates `.acl-bak` backups of `mt7915.1.dat` and `mt7915.2.dat`, sets `AccessPolicy0=2` (Blacklist mode), adds/removes the MAC in `AccessControlList0`, and reloads Wi-Fi.
- **Lines 378–389 (`modem_restart`)**: Cycles the FG360 radio (`AT+CFUN=4` → `AT+CFUN=1`) without rebooting the router.
- **Lines 391–415 (`backup_create`)**: Creates a timestamped `sysupgrade -b` archive + `.sha256` checksum under `/mnt/usb/aw1000_backups/` (or `/mnt/sda1/aw1000_backups/`).
