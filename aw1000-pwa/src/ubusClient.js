// ============================================================================
// AW1000 ubus JSON-RPC over HTTP Client (Dynamic Router Host + Auto-Failover)
// - Supports in-app switching between Local LAN IP (192.168.1.1) and Remote VPN
//   IP/Hostname without browser URL copy-paste (works in both PWA & Android APK).
// - Hard Rule #4: Never persists password; keeps only short-lived ubus_rpc_session
//   in memory / sessionStorage.
// ============================================================================

const ZERO_SESSION = "00000000000000000000000000000000";
const SESSION_KEY = "aw1000_ubus_session_token";
const ACTIVE_HOST_KEY = "aw1000_active_router_host_v2";

export const UBUS_STATUS_TEXT = {
  0: "OK",
  1: "Invalid command",
  2: "Invalid argument / malformed plugin JSON",
  3: "Method not found",
  4: "Object not found",
  5: "No data",
  6: "Access denied",
  7: "Timeout",
  8: "Not supported",
  9: "Unknown ubus error"
};

let memorySessionToken = null;
let rpcIdCounter = 1;
let activeRouterHost = "";

export function cleanHostInput(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
}

export function isValidRouterHost(raw) {
  const h = cleanHostInput(raw);
  if (!h) return false;
  // IPv4 (with optional :port)
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?$/.test(h)) {
    const parts = h.split(":")[0].split(".").map(Number);
    return parts.every((n) => n >= 0 && n <= 255);
  }
  // Valid hostname / FQDN (with optional :port)
  if (/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*(:\d{1,5})?$/.test(h)) {
    return true;
  }
  return false;
}

export function getActiveRouterHost() {
  if (typeof location !== "undefined" && (location.protocol === "https:" || location.protocol === "http:")) {
    const h = cleanHostInput(location.hostname);
    if (h && h !== "localhost" && h !== "127.0.0.1") {
      activeRouterHost = h;
      return activeRouterHost;
    }
  }
  if (activeRouterHost) return activeRouterHost;
  try {
    const stored = localStorage.getItem(ACTIVE_HOST_KEY);
    if (stored && isValidRouterHost(stored)) {
      activeRouterHost = cleanHostInput(stored);
      return activeRouterHost;
    }
  } catch (_) {}
  return "192.168.1.1";
}

export function setActiveRouterHost(host) {
  const cleaned = cleanHostInput(host);
  if (!cleaned) return activeRouterHost;
  activeRouterHost = cleaned;
  try {
    localStorage.setItem(ACTIVE_HOST_KEY, cleaned);
  } catch (_) {}
  syncNativeAllowedHosts([cleaned]);
  return activeRouterHost;
}

export function syncNativeAllowedHosts(extraHosts = []) {
  try {
    if (typeof window !== "undefined" && window.AW1000Native && typeof window.AW1000Native.setAllowedHosts === "function") {
      const rawList = localStorage.getItem("aw1000_saved_endpoints_v1");
      const saved = rawList ? JSON.parse(rawList).map((x) => x.host) : [];
      const all = Array.from(new Set(["192.168.1.1", activeRouterHost, ...saved, ...extraHosts].filter(Boolean)));
      window.AW1000Native.setAllowedHosts(all.join(","));
    }
  } catch (_) {}
}

export function getUbusEndpointUrl(overrideHost = "") {
  if (overrideHost) {
    return `https://${cleanHostInput(overrideHost)}/cgi-bin/ubus`;
  }
  if (typeof location !== "undefined" && (location.protocol === "https:" || location.protocol === "http:")) {
    return "/cgi-bin/ubus";
  }
  const target = getActiveRouterHost();
  return `https://${target}/cgi-bin/ubus`;
}

export function getSessionToken() {
  if (memorySessionToken) return memorySessionToken;
  try {
    memorySessionToken = sessionStorage.getItem(SESSION_KEY);
  } catch (_) {}
  return memorySessionToken;
}

export function setSessionToken(token) {
  memorySessionToken = token || null;
  try {
    if (token) {
      sessionStorage.setItem(SESSION_KEY, token);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch (_) {}
}

export async function ubusLogin(username = "pwa", password = "") {
  const endpoint = getUbusEndpointUrl();
  const payload = {
    jsonrpc: "2.0",
    id: rpcIdCounter++,
    method: "call",
    params: [ZERO_SESSION, "session", "login", { username, password }]
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} contacting ${endpoint}`);
  }

  const data = await res.json();
  const tuple = data?.result;
  if (!Array.isArray(tuple) || tuple[0] !== 0 || !tuple[1]?.ubus_rpc_session) {
    throw new Error("Invalid rpcd credentials or ACL denied");
  }

  setSessionToken(tuple[1].ubus_rpc_session);
  return tuple[1];
}

export async function ubusBatchCall(calls, timeoutMs = 6000, overrideHost = "", isRetry = false) {
  const token = getSessionToken() || ZERO_SESSION;
  const endpoint = getUbusEndpointUrl(overrideHost);
  const batchPayload = calls.map((c) => ({
    jsonrpc: "2.0",
    id: rpcIdCounter++,
    method: "call",
    params: [token, c.object, c.method, c.args || {}]
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batchPayload),
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} (${res.statusText || "ubus error"})`);
    }

    const results = await res.json();
    if (!Array.isArray(results)) {
      throw new Error("Invalid JSON-RPC response from /cgi-bin/ubus");
    }

    const mapped = results.map((item) => {
      const [code, data] = item?.result || [-1, null];
      if (code === 6) {
        setSessionToken(null);
      }
      const statusText = UBUS_STATUS_TEXT[code] || item?.error?.message || `ubus error (${code})`;
      return { code, data, statusText, error: item?.error };
    });

    // If any read call returned Access denied (code 6) and we haven't retried yet,
    // attempt read-only rpcd session.login for the dedicated 'pwa' service account.
    if (!isRetry && mapped.some((m) => m.code === 6)) {
      try {
        await ubusLogin("pwa", "");
        return ubusBatchCall(calls, timeoutMs, overrideHost, true);
      } catch (_) {
        // Return original Access denied result so UI displays exact error
      }
    }

    return mapped;
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error(`Timeout (${timeoutMs}ms) contacting ${endpoint}`);
    }
    throw new Error(err?.message || `Network error contacting ${endpoint}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLiveDashboardSnapshot(includeExtended = false, overrideHost = "") {
  const calls = [
    { object: "aw1000", method: "telemetry" },
    { object: "aw1000", method: "clients" }
  ];
  if (includeExtended) {
    calls.push(
      { object: "aw1000", method: "static_info" },
      { object: "aw1000", method: "modem_get" },
      { object: "aw1000", method: "wifi_get" },
      { object: "aw1000", method: "backup_list" },
      { object: "aw1000", method: "logs_get" }
    );
  }
  return ubusBatchCall(calls, includeExtended ? 10000 : 6000, overrideHost);
}

export async function fetchLiveExtendedSnapshot(overrideHost = "") {
  return ubusBatchCall(
    [
      { object: "aw1000", method: "static_info" },
      { object: "aw1000", method: "modem_get" },
      { object: "aw1000", method: "wifi_get" },
      { object: "aw1000", method: "backup_list" },
      { object: "aw1000", method: "logs_get" }
    ],
    10000,
    overrideHost
  );
}

/**
 * Fast 1.5s probe of a router host/IP (e.g. "192.168.1.1" or saved VPN URL).
 */
export async function probeEndpointReachability(hostOrUrl, timeoutMs = 1500) {
  const cleanHost = cleanHostInput(hostOrUrl);
  if (!cleanHost) return { host: cleanHost, reachable: false, latencyMs: null };

  syncNativeAllowedHosts([cleanHost]);
  const startMs = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const ubusUrl = `https://${cleanHost}/cgi-bin/ubus`;
    const payload = {
      jsonrpc: "2.0",
      id: 999,
      method: "call",
      params: [ZERO_SESSION, "aw1000", "status", {}]
    };

    try {
      const res = await fetch(ubusUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (res.ok) {
        return { host: cleanHost, reachable: true, latencyMs: Date.now() - startMs };
      }
    } catch (_) {
      await fetch(`https://${cleanHost}/app/icon.svg?_t=${Date.now()}`, {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal
      });
      return { host: cleanHost, reachable: true, latencyMs: Date.now() - startMs };
    }
    return { host: cleanHost, reachable: false, latencyMs: null };
  } catch (_) {
    return { host: cleanHost, reachable: false, latencyMs: null };
  } finally {
    clearTimeout(timer);
  }
}
