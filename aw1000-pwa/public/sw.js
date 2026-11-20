// ============================================================================
// AW1000 Control Offline & VPN-Off App-Shell Service Worker
// - Intercepts navigation requests when VPN is off (e.g. DNS_PROBE_FINISHED_NXDOMAIN
//   or connection timeout on *.netbird.cloud / *.ts.net) and serves the
//   cached PWA app shell immediately so the Local LAN recovery sheet can run.
// - Hard Rule #4: Never caches POST /ubus or credentials; caches only static UI.
// ============================================================================

const CACHE_NAME = "aw1000-pwa-shell-v19";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function fetchWithTimeout(request, timeoutMs = 2400) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("SW fetch timeout"));
    }, timeoutMs);

    fetch(request, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.url.includes("/ubus") || request.url.includes("/cgi-bin")) {
    return;
  }

  const isNav = request.mode === "navigate" || request.destination === "document";

  event.respondWith(
    fetchWithTimeout(request, isNav ? 2200 : 3000)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (isNav) {
          const shell = await caches.match("./index.html", { ignoreSearch: true });
          if (shell) return shell;
        }
        return caches.match("./", { ignoreSearch: true });
      })
  );
});
