// ============================================================================
// Dynamic VPN-Agnostic Connection Detector + Clean Live vs Mock State Separation
// - When dataSource === "live", NO mock data fallbacks are ever mixed in.
// - Dynamic detection supports Local LAN (RFC1918), NetBird, Tailscale, and
//   generic WireGuard/ZeroTier/custom VPN domains for public release.
// ============================================================================

export function detectConnectionProfile(hostname = "") {
  const h = String(hostname || "").trim().toLowerCase();

  if (!h || h === "localhost" || h === "127.0.0.1") {
    return { path: "lan", label: "Local LAN", endpoint: h || "192.168.1.1", isRemote: false };
  }

  // Tailscale CGNAT 100.64.0.0/10 (100.64.x.x - 100.127.x.x) or *.ts.net
  const tsIpMatch = h.match(/^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (h.endsWith(".ts.net") || (tsIpMatch && Number(tsIpMatch[1]) >= 64 && Number(tsIpMatch[1]) <= 127)) {
    return { path: "tailscale", label: "Remote via Tailscale", endpoint: h, isRemote: true };
  }

  // NetBird overlay (10.6.0.0/16 default mesh or *.netbird.*)
  if (h.includes("netbird") || /^10\.6\.\d{1,3}\.\d{1,3}$/.test(h)) {
    return { path: "netbird", label: "Remote via NetBird", endpoint: h, isRemote: true };
  }

  // Standard RFC1918 LAN addresses (192.168.x.x, 172.16-31.x.x, 10.0-5/7-255.x.x, *.lan, *.local)
  const isRfc1918 =
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
    h.endsWith(".lan") ||
    h.endsWith(".local");

  if (isRfc1918) {
    return { path: "lan", label: "Local LAN", endpoint: h, isRemote: false };
  }

  // Any other overlay VPN (WireGuard, ZeroTier, custom domain)
  return { path: "vpn", label: "Remote VPN", endpoint: h, isRemote: true };
}

export function getEmptyLiveSnapshot(conn) {
  return {
    router: {
      model: "AW1000 Ultra 5G",
      firmware: "OpenWrt (MT7986 / FG360)",
      kernel: "—",
      hostname: "AW1000",
      uptimeSec: 0,
      cpuLoadPct: 0,
      ramUsedMb: 0,
      ramTotalMb: 0,
      tempCelsius: 0,
      wanInterface: "ccmni2",
      wanIpv4: "—",
      wanIpv6: "—",
      pingMs: null,
      lanIp: conn.path === "lan" ? conn.endpoint : "192.168.1.1",
      callerIp: "",
      vpnType: conn.label,
      vpnEndpoint: conn.isRemote ? conn.endpoint : "—",
      vpnFqdn: "—",
      vpnMgmt: "Checking...",
      vpnSignal: "Checking...",
      vpnPeers: "—",
      tailscaleRunning: false,
      tailscaleIp: "—"
    },
    cellular: {
      operator: "Loading SIM / Carrier...",
      plmn: "—",
      mode: "5G / LTE",
      regState: "Querying FG360 modem...",
      simStatus: "READY",
      imei: "",
      imeiInput: "",
      iccid: "—",
      imsi: "—",
      apn: "—",
      pdpType: "IPv4v6",
      caStatus: "Checking CA...",
      primaryBand: "—",
      anchorBand: "—",
      pci: "—",
      cellId: "—",
      earfcn: "—",
      ta: null,
      rsrp: null,
      rsrq: null,
      sinr: null,
      nrRsrp: null,
      nrSinr: null,
      lteRsrp: null,
      lteSinr: null,
      nrRsrp: null,
      nrSinr: null,
      txPower: null,
      ttlEnabled: false,
      ttlVal: 64,
      ttlCustomInput: "65"
    },
    throughput: {
      downMbps: 0,
      upMbps: 0,
      peakDownMbps: 0,
      peakUpMbps: 0,
      totalDownGb: 0,
      totalUpGb: 0,
      historyDown: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      historyUp:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    },
    wifi: {
      ra0: {
        iface: "ra0",
        datFile: "/etc/wireless/mediatek/mt7915.1.dat",
        backupFile: "Auto .pwa-bak before write",
        bandLabel: "2.4 GHz",
        ssid: "",
        channel: 1,
        htBw: 0,
        widthLabel: "20 MHz",
        encryption: "WPA2-PSK",
        passphrase: "",
        clientsCount: 0,
        rxErrorPct: 0.0,
        txErrors: 0,
        aclPolicy: 2,
        aclList: [],
        scanNote: "2.4 GHz MediaTek MT7915 radio"
      },
      rai0: {
        iface: "rai0",
        datFile: "/etc/wireless/mediatek/mt7915.2.dat",
        backupFile: "Auto .pwa-bak before write",
        bandLabel: "5 GHz (AX)",
        ssid: "",
        channel: 36,
        htBw: 1,
        widthLabel: "80 MHz",
        encryption: "WPA2/WPA3",
        passphrase: "",
        clientsCount: 0,
        rxErrorPct: 0.0,
        txErrors: 0,
        aclPolicy: 2,
        aclList: [],
        scanNote: "5 GHz MediaTek MT7915 AX radio"
      }
    },
    devices: [],
    smsList: [],
    backups: {
      mount: "/mnt/usb",
      mounted: false,
      availKb: 0,
      totalKb: 0,
      items: []
    },
    services: [
      { name: "dropbear (SSH :22)", status: "running", protected: true, note: "Lifeline #1 — Never touched by PWA" },
      { name: "Overlay VPN (NetBird / Tailscale)", status: "running", protected: true, note: "Lifeline #2 — Strictly read-only" },
      { name: "uhttpd (:80 → :443 HTTPS)", status: "running", protected: false, note: "redirect_https=1, rfc1918_filter=1" },
      { name: "rpcd (ubus JSON-RPC)", status: "running", protected: false, note: "Dedicated 'pwa' ACL user" }
    ],
    logs: [],
    svcList: [],
    opkgOverlay: { total_kb: 0, used_kb: 0, avail_kb: 0, avail_mb: 0 },
    opkgListsUpdated: false,
    opkgInstalledCount: 0,
    opkgAvailableCount: 0,
    opkgPackages: []
  };
}

export function getMockSnapshot(conn) {
  return {
    router: {
      model: "Arcadyan AW1000 Ultra 5G",
      firmware: "OpenWrt 19.07.7 (MT7986 / FG360)",
      kernel: "5.4.188",
      hostname: "AW1000",
      uptimeSec: 284920,
      cpuLoadPct: 14,
      ramUsedMb: 312,
      ramTotalMb: 1024,
      tempCelsius: 48,
      wanInterface: "ccmni2 (fq_codel)",
      wanIpv4: "100.74.198.41",
      wanIpv6: "2400:7400:b:2104::1",
      pingMs: 18,
      lanIp: "192.168.1.1",
      callerIp: "192.168.1.142",
      vpnType: conn.label,
      vpnEndpoint: conn.endpoint,
      vpnFqdn: conn.isRemote ? conn.endpoint : "aw1000.vpn.mesh",
      vpnMgmt: "Connected",
      vpnSignal: "Connected",
      vpnPeers: "2/6 Connected",
      tailscaleRunning: false,
      tailscaleIp: "—"
    },
    cellular: {
      operator: "5G Ultra Carrier (Demo)",
      plmn: "50218",
      mode: "5G NR + LTE EN-DC",
      regState: "Registered (Home · 5G NSA/SA)",
      simStatus: "READY",
      imei: "359881204519283",
      imeiInput: "359881204519283",
      iccid: "89601802002611154829",
      imsi: "502189402817410",
      apn: "my3g",
      pdpType: "IPv4v6",
      caStatus: "2CC Active · 120 MHz",
      primaryBand: "n78 (100 MHz)",
      anchorBand: "B3 (20 MHz)",
      pci: 142,
      cellId: "0x04A9B102",
      earfcn: "633984 / 1650",
      ta: 6,
      rsrp: -78,
      rsrq: -9,
      sinr: 24.5,
      nrRsrp: -76,
      nrSinr: 25.0,
      txPower: 11,
      ttlEnabled: true,
      ttlVal: 65,
      ttlCustomInput: "65"
    },
    throughput: {
      downMbps: 348.4,
      upMbps: 64.2,
      peakDownMbps: 612.8,
      peakUpMbps: 98.4,
      totalDownGb: 142.6,
      totalUpGb: 19.8,
      historyDown: [210, 245, 290, 315, 280, 340, 395, 420, 385, 330, 360, 410, 375, 342, 368, 390, 355, 348.4],
      historyUp:   [38,  42,  51,  48,  45,  58,  66,  72,  61,  54,  59,  68,  63,  57,  62,  65,  60,  64.2]
    },
    wifi: {
      ra0: {
        iface: "ra0",
        datFile: "/etc/wireless/mediatek/mt7915.1.dat",
        backupFile: "mt7915.1.dat.pre-opt",
        bandLabel: "2.4 GHz",
        ssid: "AW1000-2.4G",
        channel: 1,
        htBw: 0,
        widthLabel: "20 MHz",
        encryption: "WPA2-PSK (CCMP)",
        passphrase: "••••••••••••",
        clientsCount: 2,
        rxErrorPct: 7.8,
        txErrors: 0,
        aclPolicy: 2,
        aclList: ["EA:81:CF:BC:3D:65"],
        scanNote: "ch1 = 1 weak AP (vs ch6 = 16 APs, ch11 = 4 APs)"
      },
      rai0: {
        iface: "rai0",
        datFile: "/etc/wireless/mediatek/mt7915.2.dat",
        backupFile: "mt7915.2.dat.pre-opt",
        bandLabel: "5 GHz (AX)",
        ssid: "AW1000-5G",
        channel: 36,
        htBw: 1,
        widthLabel: "80 MHz",
        encryption: "WPA2/WPA3-SAE",
        passphrase: "••••••••••••",
        clientsCount: 1,
        rxErrorPct: 0.0,
        txErrors: 0,
        aclPolicy: 2,
        aclList: ["EA:81:CF:BC:3D:65"],
        scanNote: "ch36 = 2 APs (retuned from ch149 = 5 APs)"
      }
    },
    devices: [
      {
        id: "d1",
        name: "Admin-Workstation (This Device)",
        ip: "192.168.1.142",
        mac: "A4:77:33:91:C2:18",
        iface: "ra0",
        band: "2.4 GHz (ra0)",
        rssi: -52,
        pingMs: 3,
        lease: "11h 42m",
        isNew: false,
        isBlocked: false,
        isCurrentAdmin: true
      },
      {
        id: "d2",
        name: "LivingRoom-Smart-TV",
        ip: "192.168.1.188",
        mac: "7C:DF:A1:20:4E:09",
        iface: "rai0",
        band: "5 GHz (rai0)",
        rssi: -61,
        pingMs: 6,
        lease: "9h 15m",
        isNew: true,
        isBlocked: false,
        isCurrentAdmin: false
      },
      {
        id: "d3",
        name: "Unknown-Guest-Phone",
        ip: "192.168.1.219",
        mac: "EA:81:CF:BC:3D:65",
        iface: "ra0",
        band: "2.4 GHz (ra0)",
        rssi: -74,
        pingMs: 14,
        lease: "Blocked in ACL",
        isNew: false,
        isBlocked: true,
        isCurrentAdmin: false
      }
    ],
    smsList: [
      {
        id: "s1",
        sender: "Carrier5G",
        time: "2026-11-19 02:14",
        unread: true,
        text: "[Demo Mock] Your 5G Unlimited data plan is active. Switch to Live /ubus to view real SIM SMS."
      }
    ],
    backups: {
      mount: "/mnt/sda1",
      mounted: true,
      availKb: 24810400,
      totalKb: 30720000,
      items: [
        {
          path: "/mnt/sda1/aw1000_backups/backup-aw1000-20261119-manual.tar.gz",
          name: "aw1000_backups/backup-aw1000-20261119-manual.tar.gz",
          size_kb: 48,
          mtime: "2026-11-19 03:10:00"
        }
      ]
    },
    services: [
      { name: "dropbear (SSH :22)", status: "running", protected: true, note: "Lifeline #1 — Never touched by PWA" },
      { name: "Overlay VPN (NetBird / Tailscale)", status: "running", protected: true, note: "Lifeline #2 — Kernel WG / Overlay" },
      { name: "uhttpd (:80 → :443 HTTPS)", status: "running", protected: false, note: "redirect_https=1, rfc1918_filter=1" },
      { name: "rpcd (ubus JSON-RPC)", status: "running", protected: false, note: "Dedicated 'pwa' ACL user" },
      { name: "telnetd (:23)", status: "disabled", protected: false, note: "Hardened: S99telnetd removed + raw DROP" }
    ],
    logs: [
      "Nov 19 04:00:01 AW1000 daemon.notice netifd: Interface 'wan' (ccmni2) 5G-NR carrier active",
      "Nov 19 03:58:12 AW1000 user.info firewall: /etc/firewall.user raw PREROUTING drop rules active (23,17171,8000,8080,3517,10240)"
    ],
    svcList: [
      { name: "dropbear", label: "Dropbear SSH (:22)", note: "Lifeline #1 — Protected read-only SSH access", installed: true, enabled: true, running: true, protected: true },
      { name: "netbird", label: "NetBird VPN (wt0)", note: "Kernel WireGuard overlay remote access", installed: true, enabled: true, running: true, protected: false },
      { name: "tailscale", label: "Tailscale VPN", note: "Secondary mesh VPN overlay daemon", installed: true, enabled: false, running: false, protected: false },
      { name: "adguardhome", label: "AdGuard Home (:3000)", note: "Network-wide DNS ad-blocker (127.0.0.1:5353)", installed: true, enabled: true, running: true, protected: false },
      { name: "firewall", label: "OpenWrt Firewall (fw3)", note: "NAT, WAN/LAN zones & /etc/firewall.user rules", installed: true, enabled: true, running: true, protected: false },
      { name: "dnsmasq", label: "Dnsmasq DHCP & DNS", note: "LAN DHCP server & local DNS forwarder (:53)", installed: true, enabled: true, running: true, protected: false }
    ],
    opkgOverlay: { total_kb: 13841203, used_kb: 184320, avail_kb: 12950000, avail_mb: 12646 },
    opkgListsUpdated: true,
    opkgInstalledCount: 889,
    opkgAvailableCount: 4120,
    opkgPackages: [
      { name: "curl", version: "7.66.0-3", installed: true, desc: "A client-side URL transfer utility" },
      { name: "htop", version: "2.2.0-4", installed: false, desc: "Interactive process viewer for Linux" },
      { name: "iperf3", version: "3.7-1", installed: false, desc: "Internet Protocol bandwidth measuring tool" },
      { name: "luci-app-3ginfo-lite", version: "1.0.75", installed: true, desc: "LuCI support for 3ginfo-lite cellular status" },
      { name: "nano", version: "5.2-1", installed: false, desc: "Small and friendly text editor" }
    ]
  };
}

const ENDPOINTS_STORAGE_KEY = "aw1000_saved_endpoints_v1";
const PROFILES_STORAGE_KEY = "aw1000_connection_profiles_v2";

export function normalizeEndpointHost(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
}

export function loadConnectionProfiles(currentHost = "") {
  const cur = normalizeEndpointHost(currentHost);
  const curProf = detectConnectionProfile(cur);
  let stored = null;
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch (_) {}

  const lanHost = normalizeEndpointHost(stored?.lanHost) || "192.168.1.1";
  let vpnHost = normalizeEndpointHost(stored?.vpnHost) || "";
  if (!vpnHost && cur && cur !== "localhost" && cur !== "127.0.0.1" && curProf.isRemote) {
    vpnHost = cur;
  }

  return { lanHost, vpnHost };
}

export function saveConnectionProfiles(lanHost, vpnHost) {
  const cleanLan = normalizeEndpointHost(lanHost) || "192.168.1.1";
  const cleanVpn = normalizeEndpointHost(vpnHost) || "";
  const obj = { lanHost: cleanLan, vpnHost: cleanVpn };
  try {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(obj));
  } catch (_) {}
  rememberEndpoint(cleanLan, "Local Wi-Fi / LAN");
  if (cleanVpn) {
    const prof = detectConnectionProfile(cleanVpn);
    rememberEndpoint(cleanVpn, prof.label);
  }
  return obj;
}

export function loadSavedEndpoints(currentHost = "") {
  const profiles = loadConnectionProfiles(currentHost);
  const defaultList = [
    { host: profiles.lanHost || "192.168.1.1", label: "Local Wi-Fi / LAN", kind: "lan" }
  ];
  if (profiles.vpnHost) {
    const vp = detectConnectionProfile(profiles.vpnHost);
    defaultList.push({ host: profiles.vpnHost, label: vp.label, kind: vp.path });
  }

  let saved = [];
  try {
    const raw = localStorage.getItem(ENDPOINTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) saved = parsed;
    }
  } catch (_) {}

  const map = new Map();
  for (const item of [...defaultList, ...saved]) {
    const h = normalizeEndpointHost(item?.host);
    if (!h || h === "localhost" || h === "127.0.0.1") continue;
    const prof = detectConnectionProfile(h);
    map.set(h, {
      host: h,
      label: item.label || prof.label,
      kind: item.kind || prof.path
    });
  }

  const cur = normalizeEndpointHost(currentHost);
  if (cur && cur !== "localhost" && cur !== "127.0.0.1" && !map.has(cur)) {
    const prof = detectConnectionProfile(cur);
    map.set(cur, { host: cur, label: prof.label, kind: prof.path });
  }

  const result = Array.from(map.values());
  try {
    localStorage.setItem(ENDPOINTS_STORAGE_KEY, JSON.stringify(result));
  } catch (_) {}
  return result;
}

export function rememberEndpoint(host, customLabel = "") {
  const h = normalizeEndpointHost(host);
  if (!h || h === "localhost" || h === "127.0.0.1" || h === "—") return loadSavedEndpoints();
  const list = loadSavedEndpoints(h);
  const prof = detectConnectionProfile(h);
  const idx = list.findIndex((item) => item.host === h);
  const entry = {
    host: h,
    label: customLabel || prof.label,
    kind: prof.path
  };
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.push(entry);
  }
  try {
    localStorage.setItem(ENDPOINTS_STORAGE_KEY, JSON.stringify(list));
  } catch (_) {}
  return list;
}

export function removeSavedEndpoint(host) {
  const h = normalizeEndpointHost(host);
  if (h === "192.168.1.1") return loadSavedEndpoints();
  const list = loadSavedEndpoints().filter((item) => item.host !== h);
  try {
    localStorage.setItem(ENDPOINTS_STORAGE_KEY, JSON.stringify(list));
  } catch (_) {}
  return list;
}

export function createInitialState() {
  const host = typeof location !== "undefined" ? location.hostname : "";
  const protocol = typeof location !== "undefined" ? location.protocol : "file:";
  const isNativeApk = typeof window !== "undefined" && Boolean(window.AW1000Native);
  const profiles = loadConnectionProfiles(host);

  let activeHost = normalizeEndpointHost(host);
  if (!activeHost || activeHost === "localhost" || activeHost === "127.0.0.1") {
    activeHost = profiles.lanHost || "192.168.1.1";
  }

  const conn = detectConnectionProfile(activeHost);
  const isDesktopFileMock = !isNativeApk && (!host || host === "localhost" || host === "127.0.0.1" || protocol === "file:");
  const initialSource = isDesktopFileMock ? "mock" : "live";
  const base = initialSource === "live" ? getEmptyLiveSnapshot(conn) : getMockSnapshot(conn);
  const savedEndpoints = loadSavedEndpoints(activeHost);

  return {
    theme: "light",
    activeTab: "home",
    editMode: false,               // Hard Rule #5: Strictly Read-only by default
    dataSource: initialSource,     // "live" | "mock"
    liveLoading: initialSource === "live",
    isNativeApk,
    activeRouterHost: activeHost,
    profileLanInput: profiles.lanHost,
    profileVpnInput: profiles.vpnHost,
    primaryHostInput: activeHost,
    connectionPath: conn.path,     // "lan" | "netbird" | "tailscale" | "vpn"
    connectionLabel: conn.label,
    connectionEndpoint: conn.endpoint,
    staleSince: null,
    lastFetchError: null,
    unreachableBanner: false,
    endpointModalOpen: false,
    endpointProbeStatus: {},
    customEndpointInput: "",
    savedEndpoints,
    sessionToken: null,
    confirmModal: null,
    trustModalOpen: false,
    loginModalOpen: false,
    loginUserInput: "pwa",
    loginPassInput: "",
    loginError: "",
    loginBusy: false,
    beeperActive: false,
    toasts: [],
    deviceFilter: "all",
    deviceSearch: "",
    logFilter: "",
    ussdInput: "*118#",
    ussdResult: initialSource === "live" ? "Dial a USSD code to query your SIM carrier." : "Demo: 5G Ultra Data Active · 184.2 GB remaining.",
    smsComposeTo: "",
    smsComposeBody: "",
    svcLoading: false,
    svcBusy: null,
    opkgLoading: false,
    opkgBusy: false,
    opkgFilter: "installed",
    opkgSearch: "",
    opkgConsoleLog: "",
    ...base
  };
}
