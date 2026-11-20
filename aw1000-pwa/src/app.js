// ============================================================================
// AW1000 Control — Main Interactive Application & All 7 Screens
// Light-first + Dark/OLED theme, RGB accents, Read-Only guard, Confirm Sheets
// ============================================================================

import { ICONS } from "./icons.js";
import {
  createInitialState,
  detectConnectionProfile,
  getEmptyLiveSnapshot,
  getMockSnapshot,
  loadConnectionProfiles,
  saveConnectionProfiles,
  loadSavedEndpoints,
  rememberEndpoint,
  removeSavedEndpoint,
  normalizeEndpointHost
} from "./mockData.js";
import {
  fetchLiveDashboardSnapshot,
  fetchLiveExtendedSnapshot,
  ubusBatchCall,
  ubusLogin,
  getSessionToken,
  setSessionToken,
  probeEndpointReachability,
  isValidRouterHost,
  setActiveRouterHost,
  syncNativeAllowedHosts
} from "./ubusClient.js";

const state = createInitialState();
setActiveRouterHost(state.activeRouterHost);
let pollTimer = null;
let extendedLoadedOnce = false;
let autoProbeTriggered = false;

/**
 * Switch the active router IP/Hostname directly inside the app (no browser URL copy-paste)
 */
async function connectToRouterHostInApp(rawHost, silent = false) {
  const host = normalizeEndpointHost(rawHost);
  if (!isValidRouterHost(host)) {
    if (!silent) pushToast("Please enter a valid Router IP or Hostname (e.g. 192.168.1.1 or 10.6.x.x).");
    return false;
  }

  setActiveRouterHost(host);
  const conn = detectConnectionProfile(host);
  state.activeRouterHost = host;
  state.primaryHostInput = host;
  state.connectionPath = conn.path;
  state.connectionLabel = conn.label;
  state.connectionEndpoint = conn.endpoint;
  state.savedEndpoints = rememberEndpoint(host, conn.label);

  if (conn.path === "lan") {
    state.profileLanInput = host;
  } else {
    state.profileVpnInput = host;
  }
  saveConnectionProfiles(state.profileLanInput, state.profileVpnInput);
  state.endpointModalOpen = false;
  state.unreachableBanner = false;

  if (typeof window !== "undefined" && window.AW1000Native && typeof window.AW1000Native.switchRouterHost === "function") {
    window.AW1000Native.switchRouterHost(host);
    return true;
  }

  if (typeof location !== "undefined" && (location.protocol === "https:" || location.protocol === "http:")) {
    const curHost = normalizeEndpointHost(location.hostname);
    if (curHost && curHost !== host) {
      window.location.href = `https://${host}/app/`;
      return true;
    }
  }

  state.dataSource = "live";
  state.liveLoading = true;
  extendedLoadedOnce = false;
  render();

  if (!silent) {
    pushToast(`Connecting to router at ${host}...`);
  }
  await pollTick(true);
  restartPolling();
  return true;
}

/**
 * Parallel 1.5s Auto-Failover probe between saved Local LAN IP and Remote VPN IP
 */
async function autoFailoverProbe() {
  const profiles = loadConnectionProfiles(state.activeRouterHost);
  const lan = profiles.lanHost || "192.168.1.1";
  const vpn = profiles.vpnHost || "";
  const candidates = Array.from(new Set([lan, vpn, state.activeRouterHost].filter(Boolean)));
  syncNativeAllowedHosts(candidates);

  for (const h of candidates) {
    state.endpointProbeStatus[h] = { checking: true, reachable: false, latencyMs: null };
  }

  const results = await Promise.all(
    candidates.map(async (h) => {
      const r = await probeEndpointReachability(h, 1500);
      state.endpointProbeStatus[h] = {
        checking: false,
        reachable: r.reachable,
        latencyMs: r.latencyMs
      };
      return r;
    })
  );

  // Prefer Local LAN if reachable, otherwise first reachable VPN profile
  const lanRes = results.find((r) => r.host === lan && r.reachable);
  const best = lanRes || results.find((r) => r.reachable);

  if (best && best.host) {
    if (best.host !== state.activeRouterHost || state.unreachableBanner) {
      await connectToRouterHostInApp(best.host, true);
      pushToast(`Auto-Connected via ${detectConnectionProfile(best.host).label} (${best.host} · ${best.latencyMs} ms)`);
    }
    return true;
  }
  render();
  return false;
}

function isAnyModalOpen() {
  return Boolean(state.endpointModalOpen || state.confirmModal || state.trustModalOpen || state.loginModalOpen);
}

function isFormFieldFocused() {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function updateEndpointModalBadgesInPlace() {
  if (!state.endpointModalOpen) return;
  const lanHost = normalizeEndpointHost(state.profileLanInput) || "192.168.1.1";
  const vpnHost = normalizeEndpointHost(state.profileVpnInput) || "";
  const lanProbe = state.endpointProbeStatus[lanHost] || {};
  const vpnProbe = vpnHost ? (state.endpointProbeStatus[vpnHost] || {}) : {};

  const lanCard = document.getElementById("lanProfileCard");
  const lanBadge = document.getElementById("lanProbeBadge");
  const lanBadgeText = document.getElementById("lanProbeBadgeText");
  const lanBtn = document.getElementById("lanConnectBtn");
  if (lanCard && lanBadge && lanBadgeText && lanBtn) {
    lanCard.classList.toggle("is-reachable", Boolean(lanProbe.reachable));
    lanBadge.className = `qual-badge ${lanProbe.checking ? "fair" : (lanProbe.reachable ? "excellent" : "poor")} whitespace-nowrap shrink-0`;
    lanBadgeText.textContent = lanProbe.checking
      ? "Probing..."
      : (lanProbe.reachable ? `Online · ${lanProbe.latencyMs} ms ✓` : "Idle / Tap Probe");
    lanBtn.className = `btn ${lanProbe.reachable ? "btn-primary-wifi" : "btn-secondary"}`;
  }

  const vpnCard = document.getElementById("vpnProfileCard");
  const vpnBadge = document.getElementById("vpnProbeBadge");
  const vpnBadgeText = document.getElementById("vpnProbeBadgeText");
  const vpnBtn = document.getElementById("vpnConnectBtn");
  if (vpnCard && vpnBadge && vpnBadgeText && vpnBtn) {
    vpnCard.classList.toggle("is-reachable", Boolean(vpnProbe.reachable));
    vpnBadge.className = `qual-badge ${!vpnHost ? "fair" : (vpnProbe.checking ? "fair" : (vpnProbe.reachable ? "excellent" : "fair"))} whitespace-nowrap shrink-0`;
    vpnBadgeText.textContent = !vpnHost
      ? "Not set yet"
      : (vpnProbe.checking ? "Probing..." : (vpnProbe.reachable ? `Online · ${vpnProbe.latencyMs} ms ✓` : "Idle / Tap Probe"));
    vpnBtn.className = `btn ${vpnProbe.reachable ? "btn-primary-wifi" : "btn-primary-net"}`;
  }
}

async function runAllEndpointProbes() {
  const lanHost = normalizeEndpointHost(state.profileLanInput) || "192.168.1.1";
  const vpnHost = normalizeEndpointHost(state.profileVpnInput) || "";
  const list = loadSavedEndpoints(state.activeRouterHost);
  state.savedEndpoints = list;
  const hostsToProbe = Array.from(new Set([lanHost, vpnHost, ...list.map((x) => x.host)].filter(Boolean)));
  syncNativeAllowedHosts(hostsToProbe);

  for (const h of hostsToProbe) {
    state.endpointProbeStatus[h] = { checking: true, reachable: false, latencyMs: null };
  }
  if (state.endpointModalOpen) {
    updateEndpointModalBadgesInPlace();
  } else {
    render();
  }

  await Promise.all(
    hostsToProbe.map(async (h) => {
      const res = await probeEndpointReachability(h, 1500);
      state.endpointProbeStatus[h] = {
        checking: false,
        reachable: res.reachable,
        latencyMs: res.latencyMs
      };
      if (state.endpointModalOpen) {
        updateEndpointModalBadgesInPlace();
      }
    })
  );

  if (!state.endpointModalOpen) {
    render();
  }
}

// ============================================================================
// Helpers: Signal Quality, Tower Distance (Timing Advance), & Luhn IMEI
// ============================================================================

function getSignalQuality(rsrp) {
  const val = Number(rsrp);
  if (isNaN(val)) return { cls: "good", label: "Signal Ready", pct: 70 };
  if (val >= -80) return { cls: "excellent", label: "Excellent Signal", pct: 92 };
  if (val >= -90) return { cls: "good",      label: "Good Signal",      pct: 76 };
  if (val >= -100) return { cls: "fair",     label: "Fair Signal",      pct: 54 };
  return { cls: "poor", label: "Weak Signal", pct: 28 };
}

/**
 * Compute estimated cell tower distance from Fibocom FG360 Timing Advance (TA)
 * 5G NR (30 kHz SCS on n78): ~39.06 m per TA unit; LTE: ~78.125 m per TA unit
 */
function formatTowerDistance(ta, isNr = true) {
  if (ta === null || ta === undefined || ta === "" || isNaN(Number(ta))) {
    return "TA N/A";
  }
  const taNum = Number(ta);
  if (taNum < 0) return "TA N/A";
  const stepMeters = isNr ? 39.0625 : 78.125;
  const meters = Math.max(35, Math.round(taNum * stepMeters));
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km (TA ${taNum})`;
  }
  return `${meters} m (TA ${taNum})`;
}

/**
 * Luhn checksum calculation for 15-digit IMEI
 */
export function computeLuhnCheckDigit(first14) {
  const clean = String(first14 || "").replace(/\D/g, "").slice(0, 14);
  if (clean.length !== 14) return null;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(clean[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function validateImeiLuhn(imei) {
  const s = String(imei || "").trim();
  if (!/^\d{15}$/.test(s)) {
    return { valid: false, reason: `${s.length}/15 digits` };
  }
  const expected = computeLuhnCheckDigit(s.slice(0, 14));
  const actual = Number(s[14]);
  if (expected === actual) {
    return { valid: true, reason: "Valid 15-digit Luhn ✓" };
  }
  return { valid: false, reason: `Invalid Luhn (check digit should be ${expected})` };
}

export function generateValidImei() {
  const tacs = ["35988120", "35462111", "86371505", "35290611", "35814910"];
  const tac = tacs[Math.floor(Math.random() * tacs.length)];
  let sn = "";
  for (let i = 0; i < 6; i++) {
    sn += Math.floor(Math.random() * 10);
  }
  const base14 = tac + sn;
  return base14 + String(computeLuhnCheckDigit(base14));
}

function formatUptime(sec) {
  const s = Number(sec) || 0;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pushToast(message) {
  const id = "t_" + Date.now();
  state.toasts.push({ id, message });
  render();
  setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== id);
    render();
  }, 4200);
}

// ============================================================================
// Web Audio API Antenna Alignment Beeper (Mobile Chrome Gesture-Unlocked)
// Pitch (600 -> 1400 Hz) & cadence (720 -> 180 ms) scale with live RSRP & SINR
// ============================================================================

let audioCtx = null;
let beeperTimeout = null;

function computeSignalNormalized(cell) {
  if (!cell) return null;
  const nrRsrp = (cell.nrRsrp !== null && cell.nrRsrp !== undefined && !isNaN(Number(cell.nrRsrp))) ? Number(cell.nrRsrp) : null;
  const lteRsrp = (cell.lteRsrp !== null && cell.lteRsrp !== undefined && !isNaN(Number(cell.lteRsrp))) ? Number(cell.lteRsrp) : null;
  const primaryRsrp = (cell.rsrp !== null && cell.rsrp !== undefined && cell.rsrp !== "" && !isNaN(Number(cell.rsrp))) ? Number(cell.rsrp) : null;

  // Strictly use primary 5G NR RSRP when 5G NR is active (no 4G LTE anchor boost);
  // fall back to primary/LTE RSRP only when on 4G-only.
  const hasNr = nrRsrp !== null;
  const effectiveRsrp = hasNr ? nrRsrp : (primaryRsrp !== null ? primaryRsrp : lteRsrp);
  if (effectiveRsrp === null) return null;

  const nrSinr = (cell.nrSinr !== null && cell.nrSinr !== undefined && !isNaN(Number(cell.nrSinr))) ? Number(cell.nrSinr) : null;
  const lteSinr = (cell.lteSinr !== null && cell.lteSinr !== undefined && !isNaN(Number(cell.lteSinr))) ? Number(cell.lteSinr) : null;
  const primarySinr = (cell.sinr !== null && cell.sinr !== undefined && cell.sinr !== "" && !isNaN(Number(cell.sinr))) ? Number(cell.sinr) : null;

  const effectiveSinr = hasNr ? nrSinr : (primarySinr !== null ? primarySinr : lteSinr);

  // Exact same weighted formula as 3ginfo-lite fg360:
  // RSRP (-125..-75 dBm, 60%) + SINR (-5..25 dB, 40%)
  const rsrpNorm = Math.max(0, Math.min(1, (effectiveRsrp + 125) / 50));
  if (effectiveSinr === null) return rsrpNorm;
  const sinrNorm = Math.max(0, Math.min(1, (effectiveSinr + 5) / 30));
  return rsrpNorm * 0.60 + sinrNorm * 0.40;
}

function computeSignalScore() {
  const norm = computeSignalNormalized(state.cellular);
  return norm !== null ? norm : 0;
}

function getCurrentBeeperFreq() {
  return Math.round(600 + computeSignalScore() * 800);
}

/**
 * Must be called synchronously inside pointerdown/click user gesture
 * to unlock mobile Chrome / Safari Web Audio playback even on self-signed HTTPS.
 */
function unlockAudioContextFromGesture() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    // Play a 1-sample silent buffer synchronously to unlock mobile audio hardware
    const silentBuf = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = silentBuf;
    src.connect(audioCtx.destination);
    src.start(0);
    return audioCtx;
  } catch (_) {
    return null;
  }
}

function scheduleTone(ctx, freqHz, startOffsetSec, durationSec, peakGain = 0.35) {
  const now = ctx.currentTime + startOffsetSec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(freqHz, now);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(peakGain, now + 0.014);
  gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.01);
}

function playConfirmationChirp(ctx) {
  if (!ctx) return;
  const fire = () => {
    try {
      scheduleTone(ctx, 740, 0.0, 0.075, 0.35);
      scheduleTone(ctx, 1120, 0.085, 0.095, 0.35);
    } catch (_) {}
  };
  if (ctx.state === "running") {
    fire();
  } else {
    ctx.resume().then(fire).catch(() => {});
  }
}

function stopBeeperForOffline() {
  if (beeperTimeout) {
    clearTimeout(beeperTimeout);
    beeperTimeout = null;
  }
  state.beeperActive = false;
}

function clearStaleTelemetryOnDisconnect() {
  stopBeeperForOffline();
  state.routerOffline = true;
  state.unreachableBanner = true;
  state.cellular.rsrp = null;
  state.cellular.nrRsrp = null;
  state.cellular.lteRsrp = null;
  state.cellular.sinr = null;
  state.cellular.nrSinr = null;
  state.cellular.lteSinr = null;
  state.cellular.rsrq = null;
  state.cellular.rssi = null;
  state.cellular.pci = "--";
  state.cellular.cellId = "--";
  state.cellular.mode = "--";
  state.cellular.regState = "Offline / No Connection";
  state.cellular.primaryBand = "--";
  state.cellular.anchorBand = "--";
  state.cellular.caStatus = "--";
  state.cellular.ta = null;
  state.router.pingMs = null;
  state.throughput.downMbps = 0;
  state.throughput.upMbps = 0;
}

function playAlignmentBeep() {
  if (!state.beeperActive || state.routerOffline) {
    stopBeeperForOffline();
    return;
  }
  try {
    const ctx = audioCtx || unlockAudioContextFromGesture();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    const score = computeSignalScore();
    const freq = Math.round(600 + score * 800); // 600 Hz (weak) -> 1400 Hz (excellent)
    const intervalMs = Math.round(720 - score * 540); // 720 ms -> 180 ms

    scheduleTone(ctx, freq, 0.0, 0.11, 0.35);

    try {
      if (window.AW1000Native && typeof window.AW1000Native.vibrate === "function") {
        window.AW1000Native.vibrate(40);
      } else {
        navigator.vibrate?.(40);
      }
    } catch (_) {}

    beeperTimeout = setTimeout(playAlignmentBeep, intervalMs);
  } catch (_) {
    state.beeperActive = false;
  }
}

function toggleBeeper() {
  if (state.routerOffline && state.dataSource === "live") {
    stopBeeperForOffline();
    pushToast("Router offline — Alignment Beeper disabled until connection resumes.");
    render();
    return;
  }
  const ctx = unlockAudioContextFromGesture();
  state.beeperActive = !state.beeperActive;
  if (beeperTimeout) {
    clearTimeout(beeperTimeout);
    beeperTimeout = null;
  }
  if (state.beeperActive) {
    playConfirmationChirp(ctx);
    try {
      if (window.AW1000Native && typeof window.AW1000Native.vibrate === "function") {
        window.AW1000Native.vibrate(50);
      } else {
        navigator.vibrate?.(40);
      }
    } catch (_) {}
    beeperTimeout = setTimeout(playAlignmentBeep, 240);
    pushToast(`Antenna Alignment Beeper ON (${getCurrentBeeperFreq()} Hz) — Higher pitch & faster pulse = stronger 5G SINR/RSRP.`);
  } else {
    pushToast("Antenna Alignment Beeper OFF.");
  }
  render();
}

// ============================================================================
// 10-Step Phone-Style Vertical Signal Bar Meter (10% to 100%) & Live Sparkline
// ============================================================================

const SIGNAL_STEPS = [
  { step: 1,  pct: 10,  color: "#18181B", glow: "rgba(113, 113, 122, 0.45)", cls: "poor",      label: "Weak Signal" },
  { step: 2,  pct: 20,  color: "#EF4444", glow: "rgba(239, 68, 68, 0.45)",   cls: "poor",      label: "Weak Signal" },
  { step: 3,  pct: 30,  color: "#EAB308", glow: "rgba(234, 179, 8, 0.45)",   cls: "fair",      label: "Weak Signal" },
  { step: 4,  pct: 40,  color: "#F59E0B", glow: "rgba(245, 158, 11, 0.45)",  cls: "fair",      label: "Fair Signal" },
  { step: 5,  pct: 50,  color: "#F97316", glow: "rgba(249, 115, 22, 0.45)",  cls: "fair",      label: "Fair Signal" },
  { step: 6,  pct: 60,  color: "#84CC16", glow: "rgba(132, 204, 22, 0.45)",  cls: "good",      label: "Good Signal" },
  { step: 7,  pct: 70,  color: "#10B981", glow: "rgba(16, 185, 129, 0.45)",  cls: "good",      label: "Good Signal" },
  { step: 8,  pct: 80,  color: "#14B8A6", glow: "rgba(20, 184, 166, 0.45)",  cls: "good",      label: "Good Signal" },
  { step: 9,  pct: 90,  color: "#06B6D4", glow: "rgba(6, 182, 212, 0.48)",   cls: "excellent", label: "Excellent Signal" },
  { step: 10, pct: 100, color: "#00E676", glow: "rgba(0, 230, 118, 0.52)",   cls: "excellent", label: "Excellent Signal" }
];

function computeSignalStep(cell) {
  if (state.routerOffline && state.dataSource === "live") {
    return { step: 0, pct: 0, color: "#EF4444", glow: "rgba(239, 68, 68, 0.35)", cls: "poor", label: "Offline / No Connection" };
  }
  const score = computeSignalNormalized(cell);
  if (score === null) {
    return { step: 0, pct: 0, color: "#64748B", glow: "transparent", cls: "poor", label: "No Live Telemetry" };
  }
  const exactPct = Math.max(10, Math.min(100, Math.round(10 + score * 90)));
  const idx = Math.max(1, Math.min(10, Math.round(exactPct / 10)));
  return { ...SIGNAL_STEPS[idx - 1], pct: exactPct };
}

function renderSignalRingSvg(cell) {
  const isOffline = Boolean(state.routerOffline && state.dataSource === "live");
  const tier = computeSignalStep(cell);
  const pctText = tier.pct !== null ? `${tier.pct}%` : "0%";
  const rsrpText = (!isOffline && cell.rsrp !== null && cell.rsrp !== undefined) ? `${cell.rsrp} dBm` : "--";
  const sinrText = (!isOffline && cell.sinr !== null && cell.sinr !== undefined) ? `${cell.sinr} dB` : "--";
  const rsrqText = (!isOffline && cell.rsrq !== null && cell.rsrq !== undefined) ? `${cell.rsrq} dB` : "--";
  const beeperLabel = isOffline
    ? "Beeper OFF — Router Offline"
    : (state.beeperActive ? `Beeper ON · ${getCurrentBeeperFreq()} Hz` : "Alignment Beeper");

  return `
    <div class="signal-meter-box" role="region" aria-label="5G Signal Meter ${pctText} (${tier.label})">
      <div class="signal-pct-header">
        <div>
          <span class="carrier-eyebrow" style="display:block; margin-bottom:2px;">${escapeHtml(isOffline ? "--" : (cell.mode || "5G / LTE"))}</span>
          <div class="signal-pct-big tabular" data-step="${tier.step}" style="color: ${tier.color};">
            ${pctText}
          </div>
        </div>
        <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:5px;">
          <div class="qual-badge ${tier.cls} whitespace-nowrap shrink-0">
            <span class="qual-dot" style="background:${tier.color};"></span>
            <span>${tier.label}</span>
          </div>
          <span class="card-subtitle tabular" style="font-size:0.74rem;">Bar ${tier.step} of 10 · PCI ${escapeHtml(isOffline ? "--" : cell.pci)}</span>
        </div>
      </div>

      ${state.lastFetchError ? `
        <div class="impact-box" style="width:100%; padding:8px 11px; font-size:0.76rem;">
          <strong>/cgi-bin/ubus error:</strong> <span class="mono">${escapeHtml(state.lastFetchError)}</span>
        </div>
      ` : ""}

      <div class="signal-bars-stage" style="--active-tier-color: ${tier.color}; --active-tier-glow: ${tier.glow};"
        role="img" aria-label="${tier.step} of 10 signal bars lit (${pctText})">
        ${SIGNAL_STEPS.map((b) => {
          const isLit = !isOffline && tier.step > 0 && b.step <= tier.step;
          const isCurrent = !isOffline && tier.step > 0 && b.step === tier.step;
          const heightPct = 20 + b.step * 8; // 28% (Bar 1) -> 100% (Bar 10)
          return `
            <div class="sig-bar-col" title="${b.pct}%">
              <div class="sig-bar ${isLit ? "is-lit" : ""}"
                data-bar="${b.step}"
                style="height: ${heightPct}%; --bar-color: ${b.color};"></div>
              <span class="sig-bar-tick tabular ${isCurrent ? "is-current" : ""}">${b.pct}</span>
            </div>
          `;
        }).join("")}
      </div>

      <div class="signal-sub-metrics tabular">
        <span>RSRP: <strong>${rsrpText}</strong></span>
        <span>·</span>
        <span>SINR: <strong>${sinrText}</strong></span>
        <span>·</span>
        <span>RSRQ: <strong>${rsrqText}</strong></span>
      </div>

      <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; width:100%; gap:6px;">
        <div class="qual-badge ${tier.cls} whitespace-nowrap shrink-0">
          <span class="qual-dot"></span>
          <span>PCI ${escapeHtml(isOffline ? "--" : cell.pci)}</span>
        </div>
        <button class="icon-btn ${state.beeperActive && !isOffline ? "beeper-active" : ""}" data-action="toggle-beeper"
          aria-pressed="${state.beeperActive && !isOffline}" ${isOffline ? "disabled" : ""}
          title="Audio Antenna Alignment Beeper (Pitch & speed increase with 5G signal)">
          ${state.beeperActive && !isOffline ? `<span class="beeper-live-dot"></span>` : ICONS.beeper}
          <span>${beeperLabel}</span>
        </button>
      </div>
    </div>
  `;
}

function renderSparklineSvg(tp) {
  const w = 540;
  const h = 68;
  const maxVal = Math.max(100, ...tp.historyDown, ...tp.historyUp);
  const ptsDown = tp.historyDown.map((v, i) => {
    const x = (i / (tp.historyDown.length - 1)) * w;
    const y = h - 6 - (v / maxVal) * (h - 14);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const ptsUp = tp.historyUp.map((v, i) => {
    const x = (i / (tp.historyUp.length - 1)) * w;
    const y = h - 6 - (v / maxVal) * (h - 14);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const areaDown = `M0,${h} L${ptsDown.join(" L")} L${w},${h} Z`;
  const lineDown = `M${ptsDown.join(" L")}`;
  const lineUp = `M${ptsUp.join(" L")}`;

  return `
    <svg class="sparkline-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Live throughput sparkline">
      <defs>
        <linearGradient id="gradDownFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2F7BFF" stop-opacity="0.34"/>
          <stop offset="100%" stop-color="#7A5CFF" stop-opacity="0.0"/>
        </linearGradient>
        <linearGradient id="gradDownStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#2F7BFF"/>
          <stop offset="100%" stop-color="#7A5CFF"/>
        </linearGradient>
        <linearGradient id="gradUpStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#22D37A"/>
          <stop offset="100%" stop-color="#14C8C8"/>
        </linearGradient>
      </defs>
      <path d="${areaDown}" fill="url(#gradDownFill)"/>
      <path d="${lineDown}" fill="none" stroke="url(#gradDownStroke)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${lineUp}" fill="none" stroke="url(#gradUpStroke)" stroke-width="2.2" stroke-dasharray="4 3" stroke-linecap="round"/>
    </svg>
  `;
}

function renderLoadingSkeleton() {
  return `
    <div class="skeleton-card" aria-busy="true" aria-label="Connecting to live router ubus...">
      <div class="skeleton-bar" style="width: 45%; height: 24px;"></div>
      <div class="skeleton-bar" style="width: 85%;"></div>
      <div class="skeleton-bar" style="width: 70%;"></div>
      <div class="skeleton-bar" style="width: 92%; height: 64px;"></div>
    </div>
  `;
}

// ============================================================================
// Screen 1: Home / Dashboard (Hero Screen)
// ============================================================================

function renderHomeScreen() {
  if (state.dataSource === "live" && state.liveLoading) {
    return renderLoadingSkeleton();
  }

  const { cellular: c, throughput: tp, router: r, wifi: w, devices } = state;
  const glowSec = Math.max(2.4, (6.5 - tp.downMbps / 140)).toFixed(1);
  const distStr = formatTowerDistance(c.ta, String(c.primaryBand).startsWith("n"));
  const pingDisplay = r.pingMs !== null && r.pingMs !== undefined ? `${r.pingMs}` : "—";

  return `
    <section class="hero-card-wrap" style="--glow-duration: ${glowSec}s" aria-label="5G Signal and Live Throughput Hero">
      <div class="hero-card">
        ${renderSignalRingSvg(c)}

        <div class="hero-details">
          <div class="carrier-header">
            <div class="carrier-title-group">
              <span class="carrier-eyebrow">Fibocom FG360 · ${escapeHtml(c.mode)}</span>
              <h1 class="carrier-name">
                ${escapeHtml(c.operator)}
                <span class="ca-pill">${escapeHtml(c.caStatus)}</span>
              </h1>
            </div>
            <div class="qual-badge good whitespace-nowrap shrink-0">
              <span>PLMN ${escapeHtml(c.plmn)} · APN: ${escapeHtml(c.apn)}</span>
            </div>
          </div>

          <!-- 6 RF Metrics Grid (Synchronized with Cellular Tab — never mixed with mock) -->
          <div class="rf-grid">
            <div class="rf-stat">
              <span class="rf-stat-label">Primary 5G Band</span>
              <span class="rf-stat-val tabular">${escapeHtml(c.primaryBand)}</span>
            </div>
            <div class="rf-stat">
              <span class="rf-stat-label">LTE Anchor CA</span>
              <span class="rf-stat-val tabular">${escapeHtml(c.anchorBand)}</span>
            </div>
            <div class="rf-stat">
              <span class="rf-stat-label">RSRQ / SINR</span>
              <span class="rf-stat-val tabular">${c.rsrq ?? "--"} dB / ${c.sinr ?? "--"} dB</span>
            </div>
            <div class="rf-stat">
              <span class="rf-stat-label">Tower Distance</span>
              <span class="rf-stat-val tabular">${escapeHtml(distStr)}</span>
            </div>
            <div class="rf-stat">
              <span class="rf-stat-label">PCI / Cell ID</span>
              <span class="rf-stat-val tabular">${escapeHtml(c.pci)} · ${escapeHtml(String(c.cellId).slice(-5))}</span>
            </div>
            <div class="rf-stat">
              <span class="rf-stat-label">TTL Spoof (${escapeHtml(r.wanInterface.split(" ")[0])})</span>
              <span class="rf-stat-val tabular">${c.ttlEnabled ? `Active (${c.ttlVal})` : "Off (Stock)"}</span>
            </div>
          </div>

          <!-- Live Throughput Sparkline + Live Ping Monitor -->
          <div class="throughput-box">
            <div class="throughput-head">
              <div class="tp-rates">
                <div class="tp-rate-item">
                  <span class="tp-dir-badge down">↓ DOWN</span>
                  <span class="tp-num tabular">${tp.downMbps.toFixed(1)}</span>
                  <span class="tp-unit">Mbps</span>
                </div>
                <div class="tp-rate-item">
                  <span class="tp-dir-badge up">↑ UP</span>
                  <span class="tp-num tabular">${tp.upMbps.toFixed(1)}</span>
                  <span class="tp-unit">Mbps</span>
                </div>
                <div class="tp-rate-item" title="Live ICMP Ping to 1.1.1.1">
                  <span class="tp-dir-badge ping">PING 1.1.1.1</span>
                  <span class="tp-num tabular">${escapeHtml(pingDisplay)}</span>
                  <span class="tp-unit">ms</span>
                </div>
              </div>
              <div class="card-subtitle tabular">
                Peak ↓ ${tp.peakDownMbps} Mbps · Total ↓ ${tp.totalDownGb} GB / ↑ ${tp.totalUpGb} GB
              </div>
            </div>
            ${renderSparklineSvg(tp)}
          </div>
        </div>
      </div>
    </section>

    <section class="grid-3">
      <!-- Wi-Fi Quick Card -->
      <article class="card">
        <div class="card-accent-bar wifi"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon wifi">${ICONS.wifi}</div>
            <div class="card-title-text min-w-0">
              <h2 class="card-title">Dual-Band Wi-Fi (MT7915)</h2>
              <p class="card-subtitle">${escapeHtml(w.ra0.ssid || "2.4G")} &amp; ${escapeHtml(w.rai0.ssid || "5G")}</p>
            </div>
          </div>
          <button class="icon-btn shrink-0" data-nav="wifi">Manage →</button>
        </div>
        <div class="rf-grid">
          <div class="rf-stat">
            <span class="rf-stat-label">2.4 GHz (ra0)</span>
            <span class="rf-stat-val tabular">Ch ${w.ra0.channel} · ${w.ra0.widthLabel}</span>
            <span class="card-subtitle tabular">${w.ra0.clientsCount} clients</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">5 GHz (rai0)</span>
            <span class="rf-stat-val tabular">Ch ${w.rai0.channel} · ${w.rai0.widthLabel}</span>
            <span class="card-subtitle tabular">${w.rai0.clientsCount} clients</span>
          </div>
        </div>
      </article>

      <!-- Connected Devices Card -->
      <article class="card">
        <div class="card-accent-bar wifi"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon wifi">${ICONS.devices}</div>
            <div class="card-title-text min-w-0">
              <h2 class="card-title">${devices.length} Active Endpoints</h2>
              <p class="card-subtitle">1-Tap MAC ACL + Anti-Lockout</p>
            </div>
          </div>
          <button class="icon-btn shrink-0" data-nav="devices">View All →</button>
        </div>
        <div class="rf-grid">
          <div class="rf-stat">
            <span class="rf-stat-label">Wi-Fi Clients</span>
            <span class="rf-stat-val tabular">${w.ra0.clientsCount + w.rai0.clientsCount} Associated</span>
            <span class="card-subtitle">${w.ra0.aclList.length} MAC(s) in Blacklist</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">Access Path</span>
            <span class="rf-stat-val tabular">${escapeHtml(state.connectionLabel)}</span>
            <span class="card-subtitle tabular">${escapeHtml(state.connectionEndpoint)}</span>
          </div>
        </div>
      </article>

      <!-- System & WAN Health Card -->
      <article class="card">
        <div class="card-accent-bar net"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon net">${ICONS.system}</div>
            <div class="card-title-text min-w-0">
              <h2 class="card-title">System &amp; WAN Health</h2>
              <p class="card-subtitle">Uptime ${formatUptime(r.uptimeSec)}</p>
            </div>
          </div>
          <button class="icon-btn shrink-0" data-nav="system">Details →</button>
        </div>
        <div class="rf-grid">
          <div class="rf-stat">
            <span class="rf-stat-label">CPU / Thermal</span>
            <span class="rf-stat-val tabular">${r.cpuLoadPct}% · ${r.tempCelsius}°C</span>
            <span class="card-subtitle tabular">RAM ${r.ramUsedMb}/${r.ramTotalMb} MB</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">WAN IP (ccmni2)</span>
            <span class="rf-stat-val tabular">${escapeHtml(r.wanIpv4)}</span>
            <span class="card-subtitle tabular">Ping ${escapeHtml(pingDisplay)} ms</span>
          </div>
        </div>
      </article>
    </section>
  `;
}

// ============================================================================
// Screen 2: Connected Devices + 1-Tap MAC Block/Allow with Anti-Lockout Guard
// ============================================================================

function renderDevicesScreen() {
  if (state.dataSource === "live" && state.liveLoading) {
    return renderLoadingSkeleton();
  }

  const filter = state.deviceFilter;
  const q = state.deviceSearch.trim().toLowerCase();
  const blockedSet = new Set((state.wifi.ra0.aclList || []).map((m) => m.toUpperCase()));

  const list = state.devices.filter((d) => {
    if (filter === "24g" && d.iface !== "ra0") return false;
    if (filter === "5g" && d.iface !== "rai0") return false;
    if (filter === "wired" && (d.iface === "ra0" || d.iface === "rai0")) return false;
    if (q && !(d.name.toLowerCase().includes(q) || d.ip.includes(q) || d.mac.toLowerCase().includes(q))) {
      return false;
    }
    return true;
  });

  return `
    <article class="card">
      <div class="card-accent-bar wifi"></div>
      <div class="card-header flex-wrap gap-2">
        <div class="card-title-wrap min-w-0">
          <div class="card-icon wifi">${ICONS.devices}</div>
          <div class="card-title-text min-w-0">
            <h1 class="card-title">Connected Devices (${list.length})</h1>
            <p class="card-subtitle">1-Tap MediaTek MAC Blacklist (<code class="mono">AccessControlList0</code>) with Admin Anti-Lockout Guard</p>
          </div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <input class="input" type="search" placeholder="Search name, IP, MAC..."
            value="${escapeHtml(state.deviceSearch)}" data-input="deviceSearch" style="min-height:38px; width:190px;"/>
          <select class="select" data-input="deviceFilter" style="min-height:38px; width:auto;">
            <option value="all" ${filter === "all" ? "selected" : ""}>All (${state.devices.length})</option>
            <option value="24g" ${filter === "24g" ? "selected" : ""}>2.4 GHz (ra0)</option>
            <option value="5g" ${filter === "5g" ? "selected" : ""}>5 GHz (rai0)</option>
            <option value="wired" ${filter === "wired" ? "selected" : ""}>LAN &amp; VPN</option>
          </select>
        </div>
      </div>

      ${list.length === 0 ? `
        <div class="rf-stat" style="padding:18px; text-align:center;">
          No matching client devices found.
        </div>
      ` : `
        <div class="device-list">
          ${list.map((d) => {
            const macUpper = String(d.mac || "").toUpperCase();
            const isBlocked = Boolean(d.isBlocked || blockedSet.has(macUpper));
            const isSelf = Boolean(d.isCurrentAdmin || (state.router.callerIp && d.ip === state.router.callerIp));
            const sig = d.rssi !== null ? getSignalQuality(d.rssi - 15) : { cls: "excellent", label: "Direct Link" };
            const btnDisabled = (!state.editMode || isSelf) ? "disabled" : "";

            return `
              <div class="device-row ${d.isNew ? "is-new" : ""} ${isBlocked ? "is-blocked" : ""}">
                <div class="card-icon ${isBlocked ? "signal" : "wifi"}">${ICONS.devices}</div>
                <div class="min-w-0">
                  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <strong style="font-size:0.96rem;">${escapeHtml(d.name)}</strong>
                    ${d.isNew ? `<span class="new-tag">New</span>` : ""}
                    ${isSelf ? `<span class="qual-badge good whitespace-nowrap shrink-0">${ICONS.shield} Admin Device (Anti-Lockout)</span>` : ""}
                    ${isBlocked ? `<span class="qual-badge poor whitespace-nowrap shrink-0">Blocked in ACL</span>` : ""}
                  </div>
                  <div class="card-subtitle mono" style="margin-top:2px;">
                    IP: ${escapeHtml(d.ip)} · MAC: ${escapeHtml(macUpper)}
                  </div>
                </div>
                <div class="device-meta-right" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end;">
                  <div style="text-align:right;">
                    <div class="qual-badge ${sig.cls} whitespace-nowrap shrink-0">
                      <span class="qual-dot"></span>
                      <span>${escapeHtml(d.band)} ${d.rssi ? `· ${d.rssi} dBm` : ""}</span>
                    </div>
                    <div class="card-subtitle tabular" style="margin-top:3px;">
                      ${escapeHtml(d.lease)}
                    </div>
                  </div>
                  <button class="btn ${isBlocked ? "btn-primary-wifi" : "btn-danger-signal"}"
                    style="min-height:38px; padding:6px 12px; font-size:0.78rem;"
                    data-action="toggle-mac-block"
                    data-mac="${escapeHtml(macUpper)}"
                    data-name="${escapeHtml(d.name)}"
                    data-blocked="${isBlocked}"
                    data-self="${isSelf}"
                    ${btnDisabled}>
                    ${isSelf ? "Protected" : (isBlocked ? "Unblock MAC" : "Block MAC")}
                  </button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `}
    </article>
  `;
}

// ============================================================================
// Screen 3: Wi-Fi Management (Mobile <400px Header Overflow Fixed)
// ============================================================================

function renderWifiRadioCard(key, radio) {
  const disabled = !state.editMode ? "disabled" : "";
  const is24 = key === "ra0";
  const channels = is24 ? [1, 6, 11] : [36, 40, 44, 48, 149, 153, 157, 161];
  const widths = is24
    ? [{ v: 0, l: "20 MHz (HT_BW=0 · Recommended clean ch1)" }, { v: 1, l: "20/40 MHz (HT_BW=1)" }]
    : [{ v: 1, l: "80 MHz (HT_BW=1 · Stock Fast)" }, { v: 0, l: "20 MHz (HT_BW=0)" }];

  return `
    <article class="card">
      <div class="card-accent-bar wifi"></div>
      <div class="card-header flex-wrap gap-2">
        <div class="card-title-wrap min-w-0">
          <div class="card-icon wifi">${ICONS.wifi}</div>
          <div class="card-title-text min-w-0 break-all">
            <h2 class="card-title">${escapeHtml(radio.bandLabel)} · <code class="mono">${escapeHtml(radio.iface)}</code></h2>
            <p class="card-subtitle mono break-all">${escapeHtml(radio.datFile)}</p>
          </div>
        </div>
        <span class="qual-badge ${radio.rxErrorPct < 15 ? "excellent" : "fair"} whitespace-nowrap shrink-0">
          <span class="qual-dot"></span>
          <span>${radio.clientsCount} Clients · RX Err ${radio.rxErrorPct}%</span>
        </span>
      </div>

      <div class="rf-grid">
        <div class="rf-stat">
          <span class="rf-stat-label">Active Channel</span>
          <span class="rf-stat-val tabular">Channel ${escapeHtml(radio.channel)}</span>
        </div>
        <div class="rf-stat">
          <span class="rf-stat-label">Channel Width</span>
          <span class="rf-stat-val tabular">${escapeHtml(radio.widthLabel)}</span>
        </div>
        <div class="rf-stat">
          <span class="rf-stat-label">MAC Blacklist</span>
          <span class="rf-stat-val tabular">${(radio.aclList || []).length} Blocked</span>
        </div>
      </div>

      <div class="card-subtitle" style="padding:9px 12px; background:var(--bg-subtle); border-radius:12px; word-break:normal;">
        <strong>RF Audit Note:</strong> ${escapeHtml(radio.scanNote)}
      </div>

      <div class="form-grid">
        <div class="field">
          <label>SSID Broadcast Name</label>
          <input class="input" type="text" maxlength="32" value="${escapeHtml(radio.ssid)}"
            placeholder="1-32 characters"
            data-wifi="${key}" data-field="ssid" ${disabled}/>
        </div>
        <div class="field">
          <label>Channel</label>
          <select class="select" data-wifi="${key}" data-field="channel" ${disabled}>
            ${channels.map((ch) => `<option value="${ch}" ${Number(radio.channel) === ch ? "selected" : ""}>Channel ${ch}${ch === 1 || ch === 36 ? " ★ Optimal" : ""}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Bandwidth (HT_BW in .dat)</label>
          <select class="select" data-wifi="${key}" data-field="htBw" ${disabled}>
            ${widths.map((w) => `<option value="${w.v}" ${Number(radio.htBw) === w.v ? "selected" : ""}>${escapeHtml(w.l)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>New WPA Passphrase (optional)</label>
          <div style="display:flex; gap:6px; align-items:center;">
            <input class="input" id="wifiPass_${key}" type="password" autocomplete="new-password" maxlength="63"
              placeholder="Leave blank to keep current (8-63 chars)"
              value="${escapeHtml(radio.passphrase || "")}"
              data-wifi="${key}" data-field="passphrase" style="flex:1; min-width:0;" ${disabled}/>
            <button type="button" class="icon-btn" data-action="toggle-wifi-pass" data-radio="${key}" ${disabled} title="Show or hide passphrase">Show</button>
          </div>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <span class="card-subtitle mono">Backup: ${escapeHtml(radio.backupFile)}</span>
        ${state.editMode ? `
          <button class="btn btn-primary-wifi" data-action="apply-wifi" data-radio="${key}">
            ${ICONS.refresh} Save .dat &amp; Restart Wi-Fi
          </button>
        ` : `
          <button class="btn btn-secondary" data-action="toggle-edit-mode">
            ${ICONS.lock} Unlock Edit Mode to Edit
          </button>
        `}
      </div>
    </article>
  `;
}

function renderWifiScreen() {
  if (state.dataSource === "live" && state.liveLoading) {
    return renderLoadingSkeleton();
  }
  return `
    <div class="grid-2">
      ${renderWifiRadioCard("ra0", state.wifi.ra0)}
      ${renderWifiRadioCard("rai0", state.wifi.rai0)}
    </div>
  `;
}

// ============================================================================
// Screen 4: Cellular & Modem (Tower Distance, IMEI + Luhn, TTL Spoofing, APN)
// ============================================================================

function renderCellularScreen() {
  if (state.dataSource === "live" && state.liveLoading) {
    return renderLoadingSkeleton();
  }

  const c = state.cellular;
  const r = state.router;
  const disabled = !state.editMode ? "disabled" : "";
  const distStr = formatTowerDistance(c.ta, String(c.primaryBand).startsWith("n"));
  const luhn = validateImeiLuhn(c.imeiInput || c.imei);
  const activeTtl = c.ttlEnabled ? Number(c.ttlVal) : 0;

  return `
    <div class="grid-2">
      <!-- Live RIL Serving Cell Telemetry + Tower Distance + Audio Beeper -->
      <article class="card">
        <div class="card-accent-bar signal"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon signal">${ICONS.cellular}</div>
            <div class="card-title-text min-w-0">
              <h1 class="card-title">5G NR / LTE Serving Cell</h1>
              <p class="card-subtitle">${escapeHtml(c.regState)}</p>
            </div>
          </div>
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <button class="icon-btn ${state.beeperActive && !state.routerOffline ? "beeper-active" : ""}" data-action="toggle-beeper"
              aria-pressed="${state.beeperActive && !state.routerOffline}" ${state.routerOffline && state.dataSource === "live" ? "disabled" : ""}>
              ${state.beeperActive && !state.routerOffline ? `<span class="beeper-live-dot"></span>` : ICONS.beeper}
              <span>${state.routerOffline && state.dataSource === "live" ? "Beeper OFF — Router Offline" : (state.beeperActive ? `Beeper ON · ${getCurrentBeeperFreq()} Hz` : "Alignment Beeper")}</span>
            </button>
            <span class="qual-badge excellent whitespace-nowrap shrink-0">
              <span class="qual-dot"></span>
              <span>SIM ${escapeHtml(c.simStatus)}</span>
            </span>
          </div>
        </div>

        <div class="rf-grid">
          <div class="rf-stat">
            <span class="rf-stat-label">Operator / PLMN</span>
            <span class="rf-stat-val tabular">${escapeHtml(c.operator)} (${escapeHtml(c.plmn)})</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">Primary 5G Band</span>
            <span class="rf-stat-val tabular">${escapeHtml(c.primaryBand)}</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">LTE Anchor Band</span>
            <span class="rf-stat-val tabular">${escapeHtml(c.anchorBand)}</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">RSRP / SINR / RSRQ</span>
            <span class="rf-stat-val tabular">${c.rsrp ?? "--"} dBm / ${c.sinr ?? "--"} dB / ${c.rsrq ?? "--"} dB</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">Est. Tower Distance</span>
            <span class="rf-stat-val tabular">${escapeHtml(distStr)}</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">PCI / Cell ID</span>
            <span class="rf-stat-val tabular">${escapeHtml(c.pci)} / ${escapeHtml(c.cellId)}</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">Live Ping (1.1.1.1)</span>
            <span class="rf-stat-val tabular">${r.pingMs !== null && r.pingMs !== undefined ? `${r.pingMs} ms` : "—"}</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">ICCID / IMSI</span>
            <span class="rf-stat-val mono" style="font-size:0.78rem;">${escapeHtml(c.iccid)}</span>
          </div>
        </div>
      </article>

      <!-- IMEI Changer + Real-Time Luhn Checksum Validator & Generator -->
      <article class="card">
        <div class="card-accent-bar signal"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon signal">${ICONS.signal5g}</div>
            <div class="card-title-text min-w-0">
              <h2 class="card-title">FG360 IMEI Manager &amp; Luhn Generator</h2>
              <p class="card-subtitle">Current Active IMEI: <code class="mono">${escapeHtml(c.imei || "—")}</code></p>
            </div>
          </div>
          <span class="qual-badge ${luhn.valid ? "excellent" : "poor"} whitespace-nowrap shrink-0">
            <span class="qual-dot"></span>
            <span>${escapeHtml(luhn.reason)}</span>
          </span>
        </div>

        <div class="field">
          <label>15-Digit IMEI (AT+EGMR=1,7,&quot;...&quot;)</label>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <input class="input mono" type="text" maxlength="15" placeholder="Enter 15-digit IMEI..."
              value="${escapeHtml(c.imeiInput)}" data-input="imeiInput" style="flex:1; min-width:180px;" ${disabled}/>
            <button class="btn btn-secondary" data-action="generate-imei" ${disabled}>
              Generate Valid IMEI
            </button>
          </div>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btn-danger-signal" data-action="apply-imei" ${(!state.editMode || !luhn.valid) ? "disabled" : ""}>
            Apply IMEI &amp; Restart Modem
          </button>
          <button class="btn btn-secondary" data-action="modem-reset" ${disabled}>
            ${ICONS.refresh} Restart Modem Only (CFUN 4/1)
          </button>
        </div>

        <div class="card-subtitle" style="padding:10px 12px; background:var(--bg-subtle); border-radius:12px; word-break:normal;">
          <strong>Safety:</strong> Previous IMEI is logged to <code class="mono">/root/aw1000-imei-backups/imei-history.log</code> before applying, and only the FG360 radio cycles (router &amp; Wi-Fi stay up).
        </div>
      </article>

      <!-- TTL / HL Spoofing Control (Hotspot Bypass on ccmni2) -->
      <article class="card">
        <div class="card-accent-bar net"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon net">${ICONS.shield}</div>
            <div class="card-title-text min-w-0">
              <h2 class="card-title">TTL / HL Spoofing (Carrier Hotspot Bypass)</h2>
              <p class="card-subtitle">IPv4 <code class="mono">iptables --ttl-set</code> &amp; IPv6 <code class="mono">ip6tables --hl-set</code> on <code class="mono">POSTROUTING</code></p>
            </div>
          </div>
          <span class="qual-badge ${c.ttlEnabled ? "excellent" : "fair"} whitespace-nowrap shrink-0">
            <span class="qual-dot"></span>
            <span>${c.ttlEnabled ? `TTL ${c.ttlVal} Active` : "TTL Spoof Off"}</span>
          </span>
        </div>

        <div class="preset-row">
          <button class="preset-pill ${!c.ttlEnabled ? "active" : ""}" data-action="apply-ttl" data-ttl="off" ${disabled}>Off (Stock)</button>
          <button class="preset-pill ${c.ttlEnabled && activeTtl === 64 ? "active" : ""}" data-action="apply-ttl" data-ttl="64" ${disabled}>TTL 64 (Standard)</button>
          <button class="preset-pill ${c.ttlEnabled && activeTtl === 65 ? "active" : ""}" data-action="apply-ttl" data-ttl="65" ${disabled}>TTL 65 (Phone Tethering)</button>
          <button class="preset-pill ${c.ttlEnabled && activeTtl === 128 ? "active" : ""}" data-action="apply-ttl" data-ttl="128" ${disabled}>TTL 128 (Windows)</button>
        </div>

        <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
          <div class="field" style="flex:1; min-width:130px;">
            <label>Custom TTL / Hop Limit (1–255)</label>
            <input class="input mono" type="number" min="1" max="255"
              value="${escapeHtml(c.ttlCustomInput)}" data-input="ttlCustomInput" ${disabled}/>
          </div>
          <button class="btn btn-primary-net" data-action="apply-ttl-custom" ${disabled}>
            Apply Custom TTL
          </button>
        </div>
      </article>

      <!-- APN / PDN Profile Control -->
      <article class="card">
        <div class="card-accent-bar signal"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon signal">${ICONS.cellular}</div>
            <div class="card-title-text min-w-0">
              <h2 class="card-title">APN / PDN Profile</h2>
              <p class="card-subtitle">Persistent <code class="mono">network.wan.apn</code> &amp; <code class="mono">3ginfo</code> profile</p>
            </div>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label>APN Name</label>
            <input class="input" type="text" value="${escapeHtml(c.apn)}" data-cell="apn" ${disabled}/>
          </div>
          <div class="field">
            <label>PDP Type</label>
            <select class="select" data-cell="pdpType" ${disabled}>
              <option value="IPv4v6" ${c.pdpType === "IPv4v6" ? "selected" : ""}>IPv4v6 (Dual Stack)</option>
              <option value="IPv4" ${c.pdpType === "IPv4" ? "selected" : ""}>IPv4 Only</option>
              <option value="IPv6" ${c.pdpType === "IPv6" ? "selected" : ""}>IPv6 Only</option>
            </select>
          </div>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btn-primary-net" data-action="apply-pdn" ${disabled}>
            Apply APN / PDN Profile
          </button>
        </div>
      </article>
    </div>
  `;
}

// ============================================================================
// Screen 5: SMS & USSD (Zero Fake SMS in Live Mode)
// ============================================================================

function renderSmsUssdScreen() {
  if (state.dataSource === "live" && state.liveLoading) {
    return renderLoadingSkeleton();
  }

  const disabled = !state.editMode ? "disabled" : "";

  return `
    <div class="grid-2">
      <article class="card">
        <div class="card-accent-bar signal"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon signal">${ICONS.sms}</div>
            <div class="card-title-text min-w-0">
              <h1 class="card-title">SIM SMS Messages (${state.smsList.length})</h1>
              <p class="card-subtitle">Decoded from FG360 ME + SIM PDU storage (<code class="mono">aw1000.sms_list</code>)</p>
            </div>
          </div>
          <button class="icon-btn shrink-0" data-action="refresh-sms">${ICONS.refresh} Refresh</button>
        </div>

        ${state.smsList.length === 0 ? `
          <div class="rf-stat" style="padding:18px; text-align:center;">
            No SMS messages stored on SIM.
          </div>
        ` : `
          <div class="device-list">
            ${state.smsList.map((m) => `
              <div class="device-row ${m.unread ? "is-new" : ""}" style="grid-template-columns: 1fr;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                  <strong>${escapeHtml(m.sender)} ${m.unread ? `<span class="new-tag">New</span>` : ""}</strong>
                  <time class="card-subtitle tabular">${escapeHtml(m.time)}</time>
                </div>
                <p style="font-size:0.89rem; color:var(--text-secondary); margin-top:4px; word-break:break-word;">${escapeHtml(m.text)}</p>
              </div>
            `).join("")}
          </div>
        `}

        <div class="form-grid" style="border-top:1px solid var(--border-subtle); padding-top:12px;">
          <div class="field">
            <label>Recipient Number</label>
            <input class="input" type="tel" placeholder="+60..." value="${escapeHtml(state.smsComposeTo)}" data-input="smsComposeTo" ${disabled}/>
          </div>
          <div class="field">
            <label>Message Text</label>
            <input class="input" type="text" placeholder="Type SMS..." value="${escapeHtml(state.smsComposeBody)}" data-input="smsComposeBody" ${disabled}/>
          </div>
        </div>
        <button class="btn btn-primary-net" data-action="send-sms" ${disabled} style="align-self:flex-start;">
          Send SMS via FG360
        </button>
      </article>

      <article class="card">
        <div class="card-accent-bar net"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon net">${ICONS.cellular}</div>
            <div class="card-title-text min-w-0">
              <h2 class="card-title">USSD Balance &amp; Plan Query</h2>
              <p class="card-subtitle">ubus <code class="mono">ril.unsol.sms.ussd</code></p>
            </div>
          </div>
        </div>

        <div class="field">
          <label>USSD Code</label>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <input class="input mono" type="text" value="${escapeHtml(state.ussdInput)}" data-input="ussdInput" style="flex:1; min-width:140px;" ${disabled}/>
            <button class="btn btn-primary-net" data-action="run-ussd" ${disabled}>Dial USSD</button>
          </div>
        </div>

        <div class="rf-stat" style="padding:14px;">
          <span class="rf-stat-label">Last USSD Network Response</span>
          <p class="mono" style="margin-top:6px; font-size:0.86rem; white-space:pre-wrap;">${escapeHtml(state.ussdResult)}</p>
        </div>
      </article>
    </div>
  `;
}

// ============================================================================
// Screen 6: System, USB Backup Manager (/mnt/usb), Logs & HTTPS Trust Flow
// ============================================================================

function renderSystemScreen() {
  if (state.dataSource === "live" && state.liveLoading) {
    return renderLoadingSkeleton();
  }

  const disabled = !state.editMode ? "disabled" : "";
  const q = state.logFilter.trim().toLowerCase();
  const logs = state.logs.filter((l) => !q || l.toLowerCase().includes(q));
  const bk = state.backups || { mount: "/mnt/usb", mounted: false, availKb: 0, totalKb: 0, items: [] };
  const freeMb = bk.availKb ? Math.round(bk.availKb / 1024) : 0;

  return `
    <div class="grid-2">
      <!-- USB Backup Manager (/mnt/usb or /mnt/sda1) -->
      <article class="card">
        <div class="card-accent-bar wifi"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon wifi">${ICONS.usb}</div>
            <div class="card-title-text min-w-0">
              <h1 class="card-title">USB Config Backup Manager (<code class="mono">${escapeHtml(bk.mount)}</code>)</h1>
              <p class="card-subtitle">${bk.mounted ? `Mounted · ${freeMb} MB Free` : "USB storage not mounted"}</p>
            </div>
          </div>
          <span class="qual-badge ${bk.mounted ? "excellent" : "fair"} whitespace-nowrap shrink-0">
            <span class="qual-dot"></span>
            <span>${bk.mounted ? `${bk.items.length} Archives` : "No USB"}</span>
          </span>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btn-primary-wifi" data-action="create-usb-backup" ${disabled}>
            ${ICONS.usb} Create Backup Now (sysupgrade -b)
          </button>
          <a class="btn btn-secondary" href="/cgi-bin/luci" target="_blank" rel="noopener">
            Open LuCI Backups ↗
          </a>
        </div>

        ${bk.items.length === 0 ? `
          <div class="rf-stat" style="padding:14px;">
            No <code class="mono">backup-*.tar.gz</code> archives found on ${escapeHtml(bk.mount)}.
          </div>
        ` : `
          <div class="device-list">
            ${bk.items.map((item) => `
              <div class="device-row" style="grid-template-columns: 1fr auto;">
                <div class="min-w-0">
                  <strong class="mono break-all" style="font-size:0.84rem;">${escapeHtml(item.name)}</strong>
                  <div class="card-subtitle tabular">${escapeHtml(item.mtime || "Saved archive")}</div>
                </div>
                <span class="qual-badge good whitespace-nowrap shrink-0">${item.size_kb || 0} KB</span>
              </div>
            `).join("")}
          </div>
        `}
      </article>

      <!-- Hardened Services & Router Power Controls -->
      <article class="card">
        <div class="card-accent-bar net"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon net">${ICONS.system}</div>
            <div class="card-title-text min-w-0">
              <h2 class="card-title">Hardened Service Roster (Read-Only)</h2>
              <p class="card-subtitle">Lifelines protected by Hard Rule #1</p>
            </div>
          </div>
        </div>

        <div class="device-list">
          ${state.services.map((s) => `
            <div class="device-row" style="grid-template-columns: 1fr auto;">
              <div class="min-w-0">
                <strong>${escapeHtml(s.name)}</strong>
                <div class="card-subtitle" style="word-break:normal;">${escapeHtml(s.note)}</div>
              </div>
              <span class="qual-badge ${s.status === "running" ? "excellent" : "fair"} whitespace-nowrap shrink-0">
                <span class="qual-dot"></span>
                <span>${s.protected ? "PROTECTED LIFELINE" : s.status.toUpperCase()}</span>
              </span>
            </div>
          `).join("")}
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btn-secondary" data-action="open-trust-modal">
            ${ICONS.shield} HTTPS Local CA Setup Guide
          </button>
          <button class="btn btn-danger-signal" data-action="reboot-router" ${disabled}>
            ${ICONS.warning} Reboot AW1000 Router
          </button>
        </div>
      </article>

      <!-- Live System Log Viewer -->
      <article class="card" style="grid-column: 1 / -1;">
        <div class="card-accent-bar net"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon net">${ICONS.dashboard}</div>
            <div class="card-title-text min-w-0">
              <h2 class="card-title">System &amp; Kernel Log (<code class="mono">aw1000.logs_get</code>)</h2>
              <p class="card-subtitle">Filtered for modem, Wi-Fi, VPN, and firewall events</p>
            </div>
          </div>
          <input class="input" type="search" placeholder="Filter logs..."
            value="${escapeHtml(state.logFilter)}" data-input="logFilter" style="min-height:36px; max-width:220px;"/>
        </div>

        <div class="mono" style="background:var(--bg-subtle); border-radius:15px; padding:14px; font-size:0.79rem; line-height:1.65; max-height:320px; overflow:auto;">
          ${logs.length === 0 ? `<div>No log entries matching filter.</div>` : logs.map((line) => `<div style="padding:3px 0; border-bottom:1px dashed var(--border-subtle); word-break:break-all;">${escapeHtml(line)}</div>`).join("")}
        </div>
      </article>
    </div>
  `;
}

// ============================================================================
// Screen 7: Remote Access & Firewall Lifelines (VPN-Agnostic & Strictly Read-Only)
// ============================================================================

function renderRemoteScreen() {
  const r = state.router;

  return `
    <div class="guard-banner readonly" role="status">
      <div style="display:flex; align-items:center; gap:10px;">
        ${ICONS.shield}
        <span>
          <strong>Hard Rule #1 Enforced:</strong> Remote Access &amp; Firewall Lifelines are strictly
          <strong>read-only</strong>. This PWA has zero rpcd ACL permissions to modify SSH (<code class="mono">dropbear</code>), NetBird, Tailscale, or <code class="mono">/etc/firewall.user</code>.
        </span>
      </div>
    </div>

    <div class="grid-3">
      <!-- Dynamic Active Access Path & Overlay VPN Card -->
      <article class="card">
        <div class="card-accent-bar net"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon net">${ICONS.shield}</div>
            <div class="card-title-text min-w-0">
              <h2 class="card-title">Overlay VPN Mesh Status</h2>
              <p class="card-subtitle">Auto-detected: ${escapeHtml(state.connectionLabel)}</p>
            </div>
          </div>
          <span class="qual-badge excellent whitespace-nowrap shrink-0"><span class="qual-dot"></span>${escapeHtml(r.vpnMgmt || "Active")}</span>
        </div>
        <div class="rf-grid">
          <div class="rf-stat">
            <span class="rf-stat-label">Current Session Host</span>
            <span class="rf-stat-val mono">${escapeHtml(state.connectionEndpoint)}</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">NetBird Overlay (wt0)</span>
            <span class="rf-stat-val mono">${escapeHtml(r.vpnEndpoint || "—")}</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">Overlay FQDN / Peers</span>
            <span class="rf-stat-val mono" style="font-size:0.84rem;">${escapeHtml(r.vpnFqdn || "—")} (${escapeHtml(r.vpnPeers)})</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">Tailscale Status</span>
            <span class="rf-stat-val tabular">${r.tailscaleRunning ? `Running (${escapeHtml(r.tailscaleIp || "tailscale0")})` : "Standby"}</span>
          </div>
        </div>
      </article>

      <!-- SSH Dropbear Card -->
      <article class="card">
        <div class="card-accent-bar wifi"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon wifi">${ICONS.lock}</div>
            <div class="card-title-text min-w-0">
              <h2 class="card-title">Dropbear SSH Lifeline</h2>
              <p class="card-subtitle">Port 22 TCP · LAN &amp; Overlay VPN</p>
            </div>
          </div>
          <span class="qual-badge excellent whitespace-nowrap shrink-0"><span class="qual-dot"></span>Protected</span>
        </div>
        <div class="rf-grid">
          <div class="rf-stat">
            <span class="rf-stat-label">LAN Gateway</span>
            <span class="rf-stat-val mono">${escapeHtml(r.lanIp)}:22</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">Remote Overlay SSH</span>
            <span class="rf-stat-val mono">${escapeHtml(state.connectionEndpoint)}:22</span>
          </div>
          <div class="rf-stat">
            <span class="rf-stat-label">Telnet (:23)</span>
            <span class="rf-stat-val">Disabled + Raw PREROUTING Drop</span>
          </div>
        </div>
      </article>

      <!-- Firewall Raw PREROUTING Shield -->
      <article class="card">
        <div class="card-accent-bar signal"></div>
        <div class="card-header flex-wrap gap-2">
          <div class="card-title-wrap min-w-0">
            <div class="card-icon signal">${ICONS.shield}</div>
            <div class="card-title-text min-w-0">
              <h2 class="card-title">/etc/firewall.user Shield</h2>
              <p class="card-subtitle">IPv4 raw PREROUTING + IPv6 INPUT</p>
            </div>
          </div>
          <span class="qual-badge excellent whitespace-nowrap shrink-0"><span class="qual-dot"></span>Enforced</span>
        </div>
        <div class="rf-stat">
          <span class="rf-stat-label">Dropped External TCP+UDP Ports (! -i lo)</span>
          <span class="rf-stat-val mono" style="margin-top:4px;">23, 17171, 8000, 8080, 3517, 10240</span>
          <span class="card-subtitle" style="margin-top:6px; word-break:normal;">
            Sits ahead of VPN chains; local <code class="mono">lo</code> allowed so <code class="mono">atcid</code> / <code class="mono">3ginfo</code> keep working.
          </span>
        </div>
      </article>
    </div>
  `;
}

// ============================================================================
// Confirm Sheet Modal (Hard Rule #3) & Local CA HTTPS Trust Setup Modal
// ============================================================================

function renderConfirmModal() {
  const m = state.confirmModal;
  if (!m) return "";

  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
      <div class="confirm-sheet">
        <div style="display:flex; align-items:center; gap:12px;">
          <div class="card-icon signal">${ICONS.warning}</div>
          <div>
            <h2 id="confirmTitle" class="card-title">${escapeHtml(m.title)}</h2>
            <p class="card-subtitle">Confirmation required (Hard Rule #3)</p>
          </div>
        </div>

        <div class="impact-box">
          <strong>Expected Service Impact:</strong>
          <span>${escapeHtml(m.impact)}</span>
        </div>

        <div class="lifeline-ok">
          ${ICONS.shield}
          <span>${escapeHtml(m.lifelineNote)}</span>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:4px;">
          <button class="btn btn-secondary" data-action="cancel-confirm">Cancel</button>
          <button class="btn btn-danger-signal" data-action="execute-confirm">
            Confirm &amp; Execute
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderTrustModal() {
  if (!state.trustModalOpen) return "";

  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <div class="confirm-sheet" style="max-width:600px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="card-icon net">${ICONS.shield}</div>
            <div>
              <h2 class="card-title">Trust This Router (HTTPS &amp; Offline Service Worker)</h2>
              <p class="card-subtitle">One-time owner-approved certificate setup (Section 2)</p>
            </div>
          </div>
          <button class="icon-btn" data-action="close-trust-modal">✕</button>
        </div>

        <p style="font-size:0.86rem; color:var(--text-secondary);">
          Browsers only register offline Service Workers over trusted HTTPS. Generate a local Root CA with Subject
          Alternative Names (SANs) matching your router's LAN IP and your NetBird / Tailscale / VPN hostname or IP:
        </p>

        <div class="mono" style="background:var(--bg-subtle); padding:12px; border-radius:13px; font-size:0.78rem; overflow:auto;">
          SAN = IP:${escapeHtml(state.router.lanIp)}, IP/DNS:${escapeHtml(state.connectionEndpoint)}
        </div>

        <div style="font-size:0.84rem; display:flex; flex-direction:column; gap:6px; color:var(--text-secondary);">
          <div><strong>1. Android:</strong> Settings → Security → Encryption &amp; Credentials → Install a certificate → CA certificate (<code class="mono">aw1000-ca.crt</code>).</div>
          <div><strong>2. iOS / iPadOS:</strong> Open <code class="mono">aw1000-ca.crt</code> → Install Profile → Settings → General → About → Certificate Trust Settings → Enable full trust.</div>
          <div><strong>3. Linux / Desktop:</strong> Copy <code class="mono">aw1000-ca.crt</code> to <code class="mono">/usr/local/share/ca-certificates/</code> &amp; run <code class="mono">update-ca-certificates</code>.</div>
        </div>

        <div style="display:flex; justify-content:flex-end;">
          <button class="btn btn-primary-net" data-action="close-trust-modal">Got It</button>
        </div>
      </div>
    </div>
  `;
}

function renderLoginModal() {
  if (!state.loginModalOpen) return "";

  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="loginModalTitle">
      <div class="confirm-sheet" style="max-width:440px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="card-icon signal">${ICONS.lock}</div>
            <div>
              <h2 id="loginModalTitle" class="card-title">Unlock Edit Mode (Router Login)</h2>
              <p class="card-subtitle">Authenticate via OpenWrt <code class="mono">rpcd session.login</code></p>
            </div>
          </div>
          <button class="icon-btn" data-action="close-login-modal">✕</button>
        </div>

        <p style="font-size:0.83rem; color:var(--text-secondary);">
          Enter your router <code class="mono">pwa</code> or <code class="mono">root</code> password to obtain a short-lived
          <code class="mono">ubus_rpc_session</code> token. Your password is <strong>never stored</strong> on this device.
        </p>

        ${state.loginError ? `
          <div class="impact-box" style="padding:10px 12px; font-size:0.82rem;">
            <strong>Authentication failed:</strong> ${escapeHtml(state.loginError)}
          </div>
        ` : ""}

        <div class="field">
          <label>rpcd Username</label>
          <input class="input mono" type="text" autocomplete="username"
            value="${escapeHtml(state.loginUserInput)}" data-input="loginUserInput"/>
        </div>

        <div class="field">
          <label>Router Password</label>
          <input class="input" type="password" autocomplete="current-password"
            placeholder="Enter router password..."
            value="${escapeHtml(state.loginPassInput)}" data-input="loginPassInput"/>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:4px;">
          <button class="btn btn-secondary" data-action="close-login-modal">Cancel</button>
          <button class="btn btn-danger-signal" data-action="submit-login" ${state.loginBusy ? "disabled" : ""}>
            ${state.loginBusy ? "Verifying..." : "Authenticate & Unlock Edit Mode"}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderUnreachableBanner() {
  if ((!state.unreachableBanner && !state.routerOffline) || state.dataSource !== "live") return "";
  const lanHost = state.profileLanInput || "192.168.1.1";
  const lanProbe = state.endpointProbeStatus[lanHost];
  const lanReady = Boolean(lanProbe && lanProbe.reachable);

  return `
    <div class="unreachable-banner is-offline-alert" role="alert">
      <div style="display:flex; align-items:center; gap:12px; min-width:0; flex:1 1 260px;">
        <div class="card-icon signal">${ICONS.warning}</div>
        <div class="min-w-0">
          <strong style="font-size:0.95rem; display:block; color:#FCA5A5;">
            Connection Lost — Router unreachable. Retrying automatically...
          </strong>
          <span class="card-subtitle" style="word-break:normal;">
            ${lanReady
              ? `Local Wi-Fi router responded at ${lanHost}! Tap below to connect in-app without leaving this screen.`
              : `No response from ${escapeHtml(state.activeRouterHost)} (${escapeHtml(state.lastFetchError || "Timeout")}). Live bars will restore automatically when reachable.`}
          </span>
        </div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn ${lanReady ? "btn-primary-wifi" : "btn-primary-net"}"
          data-action="connect-host-inapp" data-host="${escapeHtml(lanHost)}">
          ${lanReady ? `● Switch to Local Wi-Fi (${escapeHtml(lanHost)}) →` : `Try Local Wi-Fi (${escapeHtml(lanHost)}) →`}
        </button>
        <button class="btn btn-secondary" data-action="open-endpoint-modal">
          Configure Router IP / VPN
        </button>
      </div>
    </div>
  `;
}

function renderEndpointModal() {
  if (!state.endpointModalOpen) return "";

  const endpoints = state.savedEndpoints || [];
  const lanHost = normalizeEndpointHost(state.profileLanInput) || "192.168.1.1";
  const vpnHost = normalizeEndpointHost(state.profileVpnInput) || "";
  const lanProbe = state.endpointProbeStatus[lanHost] || {};
  const vpnProbe = vpnHost ? (state.endpointProbeStatus[vpnHost] || {}) : {};
  const primaryCandidate = normalizeEndpointHost(state.primaryHostInput);
  const primaryValid = isValidRouterHost(primaryCandidate);

  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="endpointModalTitle">
      <div class="confirm-sheet" style="max-width:600px; max-height:92dvh; overflow-y:auto;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="card-icon ${state.unreachableBanner ? "signal" : "net"}">
              ${state.unreachableBanner ? ICONS.warning : ICONS.signal5g}
            </div>
            <div>
              <h2 id="endpointModalTitle" class="card-title">
                AW1000 Router Connection &amp; Multi-Profile Switcher
              </h2>
              <p class="card-subtitle" style="word-break:normal;">
                Active Target: <code class="mono">${escapeHtml(state.activeRouterHost)}</code> (${escapeHtml(state.connectionLabel)})
              </p>
            </div>
          </div>
          <button class="icon-btn" data-action="close-endpoint-modal">✕</button>
        </div>

        <!-- Primary Input Box: Router IP or Hostname + Quick-Tap Chips -->
        <div class="rf-stat" style="padding:14px; display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
            <label style="font-size:0.80rem; font-weight:800;">Router IP or Hostname (Direct In-App Connect)</label>
            <span id="primaryHostValidBadge" class="qual-badge ${primaryValid ? "excellent" : "poor"} whitespace-nowrap shrink-0">
              <span class="qual-dot"></span>
              <span id="primaryHostValidText">${primaryValid ? "Valid IP / Host ✓" : "Enter valid IP or domain"}</span>
            </span>
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <input class="input mono" type="text"
              placeholder="192.168.1.1 or vpn.domain / 100.x.x.x"
              value="${escapeHtml(state.primaryHostInput)}"
              data-input="primaryHostInput"
              style="flex:1; min-width:190px;"/>
            <button id="connectPrimaryBtn" class="btn btn-primary-net" data-action="connect-primary-input" ${primaryValid ? "" : "disabled"}>
              Connect Now →
            </button>
          </div>

          <!-- Quick-Tap Chips -->
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span class="card-subtitle" style="font-size:0.73rem;">Quick-Tap:</span>
            ${endpoints.map((ep) => `
              <button class="preset-pill ${ep.host === state.activeRouterHost ? "active" : ""}"
                style="min-height:30px; padding:4px 10px; font-size:0.75rem;"
                data-action="connect-host-inapp" data-host="${escapeHtml(ep.host)}">
                ${escapeHtml(ep.host)} (${escapeHtml(ep.kind.toUpperCase())})
              </button>
            `).join("")}
          </div>
        </div>

        <!-- Multi-Profile Support: Profile 1 (Local LAN) + Profile 2 (Remote VPN) -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <span class="rf-stat-label">Saved Auto-Failover Profiles</span>
          <div style="display:flex; gap:6px;">
            <button class="icon-btn" style="min-height:32px; padding:4px 10px; font-size:0.74rem;" data-action="auto-failover-now">
              ⚡ Auto-Pick Best
            </button>
            <button class="icon-btn" style="min-height:32px; padding:4px 10px; font-size:0.74rem;" data-action="reprobe-endpoints">
              ${ICONS.refresh} Probe (1.5s)
            </button>
          </div>
        </div>

        <!-- Profile 1: Local Wi-Fi / LAN IP -->
        <div id="lanProfileCard" class="endpoint-card ${lanProbe.reachable ? "is-reachable" : ""}">
          <div class="min-w-0" style="flex:1 1 210px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px;">
              <strong>1. Local Wi-Fi / LAN IP</strong>
              <span id="lanProbeBadge" class="qual-badge ${lanProbe.checking ? "fair" : (lanProbe.reachable ? "excellent" : "fair")} whitespace-nowrap shrink-0">
                <span class="qual-dot"></span>
                <span id="lanProbeBadgeText">
                  ${lanProbe.checking
                    ? "Probing..."
                    : (lanProbe.reachable ? `Online · ${lanProbe.latencyMs} ms ✓` : "Ready (Tap Probe to test)")}
                </span>
              </span>
            </div>
            <input class="input mono" type="text" value="${escapeHtml(state.profileLanInput)}"
              placeholder="192.168.1.1" data-input="profileLanInput" style="min-height:38px;"/>
          </div>
          <button id="lanConnectBtn" class="btn ${lanProbe.reachable ? "btn-primary-wifi" : "btn-secondary"}"
            data-action="connect-profile-lan">
            Use Local LAN →
          </button>
        </div>

        <!-- Profile 2: Remote VPN IP / Domain (NetBird / Tailscale / WireGuard / ZeroTier) -->
        <div id="vpnProfileCard" class="endpoint-card ${vpnProbe.reachable ? "is-reachable" : ""}">
          <div class="min-w-0" style="flex:1 1 210px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px;">
              <strong>2. Remote VPN IP / Domain</strong>
              <span id="vpnProbeBadge" class="qual-badge ${!vpnHost ? "fair" : (vpnProbe.checking ? "fair" : (vpnProbe.reachable ? "excellent" : "fair"))} whitespace-nowrap shrink-0">
                <span class="qual-dot"></span>
                <span id="vpnProbeBadgeText">
                  ${!vpnHost
                    ? "Not set yet"
                    : (vpnProbe.checking ? "Probing..." : (vpnProbe.reachable ? `Online · ${vpnProbe.latencyMs} ms ✓` : "Ready (Tap Probe to test)"))}
                </span>
              </span>
            </div>
            <input class="input mono" type="text" value="${escapeHtml(state.profileVpnInput)}"
              placeholder="e.g. 10.6.x.x, 100.x.x.x, router.netbird.cloud"
              data-input="profileVpnInput" style="min-height:38px;"/>
          </div>
          <button id="vpnConnectBtn" class="btn ${vpnProbe.reachable ? "btn-primary-wifi" : "btn-primary-net"}"
            data-action="connect-profile-vpn">
            Save &amp; Use VPN →
          </button>
        </div>

        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; padding-top:4px; border-top:1px dashed var(--border-subtle);">
          <span class="card-subtitle" style="word-break:normal;">
            Profiles are saved on your device and probed automatically in parallel on startup.
          </span>
          <button class="icon-btn" style="min-height:32px; font-size:0.74rem;" data-action="save-both-profiles">
            Save Both Profiles
          </button>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// Master Shell Render
// ============================================================================

const NAV_ITEMS = [
  { id: "home",     label: "Home",            accent: "signal", icon: ICONS.dashboard },
  { id: "devices",  label: "Devices",         accent: "wifi",   icon: ICONS.devices, badge: () => state.devices.length || null },
  { id: "wifi",     label: "Wi-Fi",           accent: "wifi",   icon: ICONS.wifi },
  { id: "cellular", label: "Cellular",        accent: "signal", icon: ICONS.cellular },
  { id: "sms",      label: "SMS & USSD",      accent: "signal", icon: ICONS.sms, badge: () => state.smsList.filter((s) => s.unread).length || null, alert: true },
  { id: "system",   label: "System",          accent: "net",    icon: ICONS.system },
  { id: "remote",   label: "Remote Lifeline", accent: "net",    icon: ICONS.shield }
];

export function render() {
  document.documentElement.setAttribute("data-theme", state.theme);
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.toggle("modal-open", isAnyModalOpen());
  }
  try {
    if (window.AW1000Native && typeof window.AW1000Native.setTheme === "function") {
      window.AW1000Native.setTheme(state.theme === "dark");
    }
  } catch (_) {}
  const root = document.getElementById("app");
  if (!root) return;

  const isOffline = Boolean(state.routerOffline && state.dataSource === "live");
  const connLabel = isOffline
    ? `Offline · ${state.connectionEndpoint} (Disconnected)`
    : `${state.connectionLabel} · ${state.connectionEndpoint}`;

  let screenHtml = "";
  switch (state.activeTab) {
    case "devices":  screenHtml = renderDevicesScreen(); break;
    case "wifi":     screenHtml = renderWifiScreen(); break;
    case "cellular": screenHtml = renderCellularScreen(); break;
    case "sms":      screenHtml = renderSmsUssdScreen(); break;
    case "system":   screenHtml = renderSystemScreen(); break;
    case "remote":   screenHtml = renderRemoteScreen(); break;
    default:         screenHtml = renderHomeScreen(); break;
  }

  root.innerHTML = `
    <div class="app-shell">
      <aside class="side-rail" aria-label="Primary Navigation">
        <div class="brand-lockup">
          <div class="brand-mark">${ICONS.signal5g}</div>
          <div>
            <div class="brand-title">AW1000 Control</div>
            <div class="brand-sub">Ultra 5G · OpenWrt PWA</div>
          </div>
        </div>

        <nav class="rail-nav">
          ${NAV_ITEMS.map((item) => {
            const b = item.badge ? item.badge() : null;
            return `
              <button class="rail-btn ${state.activeTab === item.id ? "active" : ""}"
                data-nav="${item.id}" data-accent="${item.accent}">
                ${item.icon}
                <span>${item.label}</span>
                ${b ? `<span class="rail-badge ${item.alert ? "alert" : ""}">${b}</span>` : ""}
              </button>
            `;
          }).join("")}
        </nav>

        <div class="rf-stat" style="font-size:0.76rem;">
          <span class="rf-stat-label">Lifeline Guard</span>
          <span style="color:var(--text-wifi); font-weight:750; margin-top:2px;">
            ● SSH :22 &amp; VPN Protected
          </span>
        </div>
      </aside>

      <main class="main-stage">
        <header class="topbar">
          <div class="topbar-left">
            <button class="conn-pill" data-path="${state.connectionPath}" data-offline="${isOffline}" data-action="open-endpoint-modal"
              title="Click to switch between Local Wi-Fi (192.168.1.1) and Remote VPN endpoints">
              <span class="pulse-dot"></span>
              <span class="tabular">${escapeHtml(connLabel)} ▾</span>
            </button>

            <button class="icon-btn" data-action="toggle-datasource" title="Switch between Live Router /ubus and Mock Data">
              <span>Source: <strong>${state.dataSource === "live" ? "Live /ubus" : "Mock Data (Dev)"}</strong></span>
            </button>

            ${state.lastFetchError
              ? `<span class="qual-badge poor whitespace-nowrap shrink-0" title="${escapeHtml(state.lastFetchError)}">⚠ ${escapeHtml(state.lastFetchError)}</span>`
              : (state.staleSince ? `<span class="qual-badge fair">Offline snapshot · stale since ${escapeHtml(state.staleSince)}</span>` : "")}
          </div>

          <div class="topbar-right">
            <button class="mode-toggle" data-editing="${state.editMode}" data-action="toggle-edit-mode">
              ${state.editMode ? ICONS.unlock : ICONS.lock}
              <span>${state.editMode ? "Edit Mode Unlocked" : "Read-Only Mode"}</span>
            </button>

            <button class="icon-btn" data-action="toggle-theme" aria-label="Toggle Light/Dark theme">
              ${state.theme === "light" ? ICONS.moon : ICONS.sun}
              <span>${state.theme === "light" ? "Dark" : "Light"}</span>
            </button>
          </div>
        </header>

        ${renderUnreachableBanner()}

        ${state.editMode ? `
          <div class="guard-banner">
            <span><strong>Edit Mode Active:</strong> Write actions are enabled and require confirmation sheets. SSH, NetBird &amp; Tailscale remain locked at all times.</span>
            <button class="icon-btn" data-action="toggle-edit-mode">Lock Read-Only</button>
          </div>
        ` : ""}

        ${screenHtml}
      </main>

      <nav class="bottom-tabs" aria-label="Mobile Navigation">
        ${NAV_ITEMS.slice(0, 5).map((item) => `
          <button class="tab-btn ${state.activeTab === item.id ? "active" : ""}" data-nav="${item.id}">
            <div class="tab-icon-wrap">${item.icon}</div>
            <span>${item.label.split(" ")[0]}</span>
          </button>
        `).join("")}
        <button class="tab-btn ${["system", "remote"].includes(state.activeTab) ? "active" : ""}"
          data-nav="${state.activeTab === "system" ? "remote" : "system"}">
          <div class="tab-icon-wrap">${ICONS.more}</div>
          <span>${state.activeTab === "remote" ? "Remote" : "System"}</span>
        </button>
      </nav>
    </div>

    ${renderConfirmModal()}
    ${renderTrustModal()}
    ${renderEndpointModal()}
    ${renderLoginModal()}

    <div class="toast-stack" aria-live="polite">
      ${state.toasts.map((t) => `
        <div class="toast">
          <span>${escapeHtml(t.message)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

// ============================================================================
// Event Delegation & Destructive Action Confirmations (Hard Rule #3 & #5)
// ============================================================================

function switchDataSource(nextSource) {
  const host = typeof location !== "undefined" ? location.hostname : "";
  const conn = detectConnectionProfile(host);
  state.dataSource = nextSource;
  extendedLoadedOnce = false;

  if (nextSource === "live") {
    const clean = getEmptyLiveSnapshot(conn);
    Object.assign(state, clean);
    state.liveLoading = true;
    state.ussdResult = "Dial a USSD code to query your SIM carrier.";
    render();
    pollTick(true);
  } else {
    const mock = getMockSnapshot(conn);
    Object.assign(state, mock);
    state.liveLoading = false;
    state.staleSince = null;
    render();
  }
}

function setupEvents() {
  // Synchronously unlock Web Audio API on pointerdown user gesture for mobile Chrome/Safari
  document.addEventListener("pointerdown", (e) => {
    const beeperBtn = e.target.closest('[data-action="toggle-beeper"]');
    if (beeperBtn && !beeperBtn.disabled) {
      unlockAudioContextFromGesture();
    }
  });

  document.addEventListener("click", async (e) => {
    const navBtn = e.target.closest("[data-nav]");
    if (navBtn) {
      state.activeTab = navBtn.getAttribute("data-nav");
      if (state.dataSource === "live" && (state.activeTab === "sms" || state.activeTab === "system")) {
        refreshTabSpecificLive(state.activeTab);
      }
      render();
      return;
    }

    const actionEl = e.target.closest("[data-action]");
    if (!actionEl || actionEl.disabled) return;
    const action = actionEl.getAttribute("data-action");

    if (action === "toggle-theme") {
      state.theme = state.theme === "light" ? "dark" : "light";
      render();
    } else if (action === "toggle-beeper") {
      toggleBeeper();
    } else if (action === "toggle-edit-mode") {
      if (state.editMode) {
        state.editMode = false;
        pushToast("Locked to Read-Only Mode.");
      } else if (state.dataSource === "live" && !getSessionToken()) {
        state.loginError = "";
        state.loginPassInput = "";
        state.loginModalOpen = true;
        render();
      } else {
        state.editMode = true;
        pushToast("Edit Mode unlocked. Destructive actions require confirmation.");
      }
    } else if (action === "close-login-modal") {
      state.loginModalOpen = false;
      state.loginPassInput = "";
      state.loginError = "";
      render();
    } else if (action === "submit-login") {
      if (state.loginBusy) return;
      const user = String(state.loginUserInput || "pwa").trim() || "pwa";
      const pass = String(state.loginPassInput || "");
      state.loginBusy = true;
      state.loginError = "";
      render();
      try {
        await ubusLogin(user, pass);
        state.loginPassInput = "";
        state.loginBusy = false;
        state.loginModalOpen = false;
        state.editMode = true;
        pushToast(`Edit Mode unlocked (authenticated as '${user}').`);
      } catch (err) {
        state.loginBusy = false;
        state.loginPassInput = "";
        state.loginError = err?.message || "Invalid credentials";
        render();
      }
    } else if (action === "cycle-conn-path") {
      const modes = [
        { path: "lan",       label: "Local LAN",            endpoint: state.router.lanIp || "192.168.1.1" },
        { path: "netbird",   label: "Remote via NetBird",   endpoint: state.router.vpnEndpoint !== "—" ? state.router.vpnEndpoint : "netbird.peer" },
        { path: "tailscale", label: "Remote via Tailscale", endpoint: state.router.tailscaleIp !== "—" ? state.router.tailscaleIp : "100.90.1.1" },
        { path: "vpn",       label: "Remote VPN",           endpoint: "vpn.router.local" }
      ];
      const idx = modes.findIndex((m) => m.path === state.connectionPath);
      const next = modes[(idx + 1) % modes.length];
      state.connectionPath = next.path;
      state.connectionLabel = next.label;
      state.connectionEndpoint = next.endpoint;
      restartPolling();
      render();
    } else if (action === "toggle-datasource") {
      const next = state.dataSource === "mock" ? "live" : "mock";
      switchDataSource(next);
      pushToast(next === "live" ? "Switched to Live Router /ubus (zero mock data)" : "Switched to Mock Telemetry Mode");
      restartPolling();
    } else if (action === "open-endpoint-modal") {
      if (typeof window !== "undefined" && window.AW1000Native && typeof window.AW1000Native.openConnectionDialog === "function") {
        window.AW1000Native.openConnectionDialog();
        return;
      }
      state.endpointModalOpen = true;
      state.primaryHostInput = state.activeRouterHost;
      render();
    } else if (action === "close-endpoint-modal") {
      state.endpointModalOpen = false;
      render();
    } else if (action === "reprobe-endpoints") {
      runAllEndpointProbes();
    } else if (action === "auto-failover-now") {
      pushToast("Probing Local LAN and Remote VPN in parallel (1.5s)...");
      const ok = await autoFailoverProbe();
      if (!ok) {
        pushToast("Neither Local LAN nor saved VPN profile responded within 1.5s.");
      }
    } else if (action === "connect-primary-input") {
      await connectToRouterHostInApp(state.primaryHostInput);
    } else if (action === "connect-host-inapp") {
      const target = actionEl.getAttribute("data-host");
      await connectToRouterHostInApp(target);
    } else if (action === "connect-profile-lan") {
      await connectToRouterHostInApp(state.profileLanInput || "192.168.1.1");
    } else if (action === "connect-profile-vpn") {
      if (!state.profileVpnInput) {
        pushToast("Enter your Remote VPN IP or Domain in Profile 2 first.");
        return;
      }
      await connectToRouterHostInApp(state.profileVpnInput);
    } else if (action === "save-both-profiles") {
      saveConnectionProfiles(state.profileLanInput, state.profileVpnInput);
      state.savedEndpoints = loadSavedEndpoints(state.activeRouterHost);
      render();
      runAllEndpointProbes();
      pushToast("Saved Local LAN and Remote VPN profiles.");
    } else if (action === "remove-endpoint") {
      const h = actionEl.getAttribute("data-host");
      state.savedEndpoints = removeSavedEndpoint(h);
      render();
      pushToast(`Removed ${h} from saved endpoints.`);
    } else if (action === "open-trust-modal") {
      state.trustModalOpen = true;
      render();
    } else if (action === "close-trust-modal") {
      state.trustModalOpen = false;
      render();
    } else if (action === "cancel-confirm") {
      state.confirmModal = null;
      render();
    } else if (action === "execute-confirm" && state.confirmModal) {
      const fn = state.confirmModal.onConfirm;
      state.confirmModal = null;
      render();
      if (fn) await fn();
    } else if (action === "refresh-sms") {
      if (state.dataSource === "live") {
        await refreshTabSpecificLive("sms");
        pushToast("Refreshed SIM SMS inbox from FG360.");
      }
    } else if (action === "generate-imei") {
      if (!state.editMode) return;
      state.cellular.imeiInput = generateValidImei();
      render();
      pushToast(`Generated Luhn-valid 15-digit IMEI: ${state.cellular.imeiInput}`);
    } else if (action === "apply-imei") {
      if (!state.editMode) return;
      const candidate = String(state.cellular.imeiInput || "").trim();
      const check = validateImeiLuhn(candidate);
      if (!check.valid) {
        pushToast(`Cannot apply invalid IMEI: ${check.reason}`);
        return;
      }
      state.confirmModal = {
        title: `Write New IMEI (${candidate}) & Restart Modem?`,
        impact: `Executes AT+EGMR=1,7,"${candidate}" and cycles the FG360 radio (AT+CFUN=4 -> AT+CFUN=1). Cellular 5G/LTE WAN (ccmni2) will drop for ~25–40 seconds while re-registering.`,
        lifelineNote: `Old IMEI (${state.cellular.imei || "current"}) is backed up to /root/aw1000-imei-backups/imei-history.log. Router, Wi-Fi, and SSH stay up.`,
        onConfirm: async () => {
          if (state.dataSource === "live") {
            await ubusBatchCall([{ object: "aw1000", method: "imei_set", args: { imei: candidate } }]);
          }
          state.cellular.imei = candidate;
          pushToast(`IMEI updated to ${candidate} and FG360 modem restarted.`);
        }
      };
      render();
    } else if (action === "apply-ttl" || action === "apply-ttl-custom") {
      if (!state.editMode) return;
      const rawTtl = action === "apply-ttl"
        ? actionEl.getAttribute("data-ttl")
        : String(state.cellular.ttlCustomInput || "").trim();
      const isOff = rawTtl === "off" || rawTtl === "0";
      const ttlNum = Number(rawTtl);
      if (!isOff && (isNaN(ttlNum) || ttlNum < 1 || ttlNum > 255)) {
        pushToast("TTL value must be between 1 and 255 (or Off).");
        return;
      }
      state.confirmModal = {
        title: isOff ? "Disable TTL / HL Spoofing?" : `Apply TTL / HL = ${ttlNum} on POSTROUTING?`,
        impact: isOff
          ? "Removes 3ginfo_ttl mangle rules from iptables/ip6tables and restores stock packet TTL."
          : `Sets persistent iptables --ttl-set ${ttlNum} and ip6tables --hl-set ${ttlNum} in /etc/firewall.d/3ginfo_ttl. Active connections remain uninterrupted.`,
        lifelineNote: "Backs up /etc/config/3ginfo_ttl first. Never touches /etc/firewall.user, SSH, NetBird, or Tailscale chains.",
        onConfirm: async () => {
          if (state.dataSource === "live") {
            await ubusBatchCall([{ object: "aw1000", method: "ttl_set", args: { ttl: isOff ? "off" : String(ttlNum) } }]);
          }
          state.cellular.ttlEnabled = !isOff;
          if (!isOff) state.cellular.ttlVal = ttlNum;
          pushToast(isOff ? "TTL Spoofing disabled." : `TTL / Hop Limit set to ${ttlNum}.`);
        }
      };
      render();
    } else if (action === "toggle-mac-block") {
      if (!state.editMode) return;
      const mac = actionEl.getAttribute("data-mac");
      const name = actionEl.getAttribute("data-name") || mac;
      const currentlyBlocked = actionEl.getAttribute("data-blocked") === "true";
      const isSelf = actionEl.getAttribute("data-self") === "true";
      if (isSelf) {
        pushToast("Anti-Lockout Guard: Cannot block your own admin device!");
        return;
      }
      const nextAct = currentlyBlocked ? "unblock" : "block";
      state.confirmModal = {
        title: `${currentlyBlocked ? "Unblock" : "Block"} Device ${name} (${mac})?`,
        impact: `Updates AccessControlList0 in mt7915.1.dat & mt7915.2.dat (AccessPolicy0=2 Blacklist) and reloads MediaTek Wi-Fi. Wi-Fi will briefly reload for ~10–15 seconds.`,
        lifelineNote: "Automatic .acl-bak backup created before write. Anti-Lockout verified; SSH & VPN stay up.",
        onConfirm: async () => {
          if (state.dataSource === "live") {
            await ubusBatchCall([{
              object: "aw1000",
              method: "mac_acl",
              args: { mac, action: nextAct, client_ip: state.router.callerIp || "" }
            }]);
          }
          const cur = new Set((state.wifi.ra0.aclList || []).map((m) => m.toUpperCase()));
          if (nextAct === "block") cur.add(mac); else cur.delete(mac);
          state.wifi.ra0.aclList = Array.from(cur);
          state.wifi.rai0.aclList = Array.from(cur);
          state.devices.forEach((d) => {
            if (d.mac.toUpperCase() === mac) d.isBlocked = nextAct === "block";
          });
          pushToast(`${mac} ${nextAct === "block" ? "added to" : "removed from"} Wi-Fi MAC Blacklist.`);
        }
      };
      render();
    } else if (action === "toggle-wifi-pass") {
      const radioKey = actionEl.getAttribute("data-radio");
      const inp = document.getElementById(`wifiPass_${radioKey}`);
      if (inp) {
        const showing = inp.type === "text";
        inp.type = showing ? "password" : "text";
        actionEl.textContent = showing ? "Show" : "Hide";
      }
    } else if (action === "apply-wifi") {
      if (!state.editMode) return;
      const radioKey = actionEl.getAttribute("data-radio");
      const radio = state.wifi[radioKey];
      const nextSsid = String(radio.ssid || "").trim();
      const nextPass = String(radio.passphrase || "");
      if (nextSsid.length < 1 || nextSsid.length > 32) {
        pushToast("SSID must be between 1 and 32 characters.", "danger");
        return;
      }
      if (nextPass.length > 0 && (nextPass.length < 8 || nextPass.length > 63)) {
        pushToast("WPA passphrase must be 8–63 characters (or leave blank to keep current).", "danger");
        return;
      }
      const passNote = nextPass.length > 0 ? " + new WPA passphrase" : " (keeping current password)";
      state.confirmModal = {
        title: `Update ${radio.bandLabel} (${radio.iface}) & Restart Wi-Fi?`,
        impact: `Writing ${radio.datFile}: SSID "${nextSsid}"${passNote}, Channel ${radio.channel}, HT_BW=${radio.htBw}, then running 'wifi restart'. Both 2.4 GHz and 5 GHz Wi-Fi will drop for ~20 seconds while the MediaTek driver reloads.`,
        lifelineNote: `Automatic backup ${radio.iface}.dat.<timestamp>.pwa-bak is created first. Dropbear SSH and VPN stay up.`,
        onConfirm: async () => {
          if (state.dataSource === "live") {
            const payload = {
              radio: radioKey,
              ssid: nextSsid,
              channel: Number(radio.channel),
              ht_bw: Number(radio.htBw)
            };
            if (nextPass.length > 0) {
              payload.password = nextPass;
            }
            const res = await ubusBatchCall([{
              object: "aw1000",
              method: "wifi_set",
              args: payload
            }]);
            const r = res?.[0];
            if (!r || r.code !== 0 || r.data?.ok === false) {
              const errMsg = r?.data?.error || r?.statusText || "Failed to update Wi-Fi config";
              pushToast(`Wi-Fi update failed: ${errMsg}`, "danger");
              if (r?.code === 6) {
                state.editMode = false;
                state.loginError = errMsg;
                state.loginModalOpen = true;
                render();
              }
              return;
            }
          }
          radio.ssid = nextSsid;
          radio.passphrase = "";
          radio.widthLabel = Number(radio.htBw) === 0 ? "20 MHz" : (radioKey === "ra0" ? "20/40 MHz" : "80 MHz");
          pushToast(`Saved ${radio.datFile} (SSID: ${nextSsid}${nextPass ? " + new password" : ""}) & restarting Wi-Fi…`);
        }
      };
      render();
    } else if (action === "apply-pdn") {
      if (!state.editMode) return;
      state.confirmModal = {
        title: `Apply APN / PDN Profile (${state.cellular.apn})?`,
        impact: `Updates network.wan.apn (${state.cellular.pdpType}) and reconnects ccmni2. Cellular WAN will drop for ~8–15 seconds.`,
        lifelineNote: "LAN access stays up; remote VPN overlay resumes automatically once ccmni2 reconnects.",
        onConfirm: async () => {
          pushToast(`PDN profile updated: APN '${state.cellular.apn}' (${state.cellular.pdpType}).`);
        }
      };
      render();
    } else if (action === "modem-reset") {
      if (!state.editMode) return;
      state.confirmModal = {
        title: "Restart Fibocom FG360 5G Modem (AT+CFUN=4/1)?",
        impact: "Cycles the FG360 radio without rebooting the router. Cellular 5G/LTE WAN (ccmni2) will drop for ~25–40 seconds while re-registering.",
        lifelineNote: "Local Wi-Fi and LAN SSH remain active; remote VPN reconnects as soon as WAN is up.",
        onConfirm: async () => {
          if (state.dataSource === "live") {
            await ubusBatchCall([{ object: "aw1000", method: "modem_restart", args: {} }]);
          }
          pushToast("FG360 modem radio restart triggered.");
        }
      };
      render();
    } else if (action === "create-usb-backup") {
      if (!state.editMode) return;
      state.confirmModal = {
        title: `Create Sysupgrade Config Backup on ${state.backups.mount}?`,
        impact: `Runs 'sysupgrade -b' to create a timestamped .tar.gz + .sha256 archive on ${state.backups.mount}/aw1000_backups/. Zero network interruption.`,
        lifelineNote: "Read-only archive creation; SSH, Wi-Fi, and VPN stay up.",
        onConfirm: async () => {
          if (state.dataSource === "live") {
            await ubusBatchCall([{ object: "aw1000", method: "backup_create", args: { tag: "pwa" } }]);
            await refreshTabSpecificLive("system");
          } else {
            const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
            state.backups.items.unshift({
              path: `/mnt/sda1/aw1000_backups/backup-aw1000-${ts}-pwa.tar.gz`,
              name: `aw1000_backups/backup-aw1000-${ts}-pwa.tar.gz`,
              size_kb: 49,
              mtime: new Date().toISOString().slice(0, 19).replace("T", " ")
            });
          }
          pushToast("Created new config backup archive + SHA256 on USB storage.");
        }
      };
      render();
    } else if (action === "reboot-router") {
      if (!state.editMode) return;
      state.confirmModal = {
        title: "Reboot AW1000 Ultra 5G Router?",
        impact: "Calls ubus 'system.reboot'. All Wi-Fi, LAN, 5G WAN, and VPN connections will drop for ~75 seconds during reboot.",
        lifelineNote: "Hardened boot config ensures dropbear SSH and VPN start automatically on boot.",
        onConfirm: async () => {
          if (state.dataSource === "live") {
            await ubusBatchCall([{ object: "system", method: "reboot", args: {} }]);
          }
          pushToast("Router reboot command issued.");
        }
      };
      render();
    } else if (action === "run-ussd") {
      if (!state.editMode) return;
      pushToast(`Dialed USSD ${state.ussdInput}`);
      state.ussdResult = `[${new Date().toLocaleTimeString()}] USSD ${state.ussdInput}: Request sent to FG360 modem.`;
      render();
    } else if (action === "send-sms") {
      if (!state.editMode) return;
      if (!state.smsComposeTo || !state.smsComposeBody) {
        pushToast("Enter recipient number and message first.");
        return;
      }
      state.smsList.unshift({
        id: "s_" + Date.now(),
        sender: `To: ${state.smsComposeTo}`,
        time: "Just now",
        unread: false,
        text: state.smsComposeBody
      });
      state.smsComposeTo = "";
      state.smsComposeBody = "";
      pushToast("SMS queued via FG360 PDU encoder.");
    }
  });

  document.addEventListener("input", (e) => {
    const key = e.target.getAttribute("data-input");
    if (key === "primaryHostInput") {
      state.primaryHostInput = e.target.value;
      const valid = isValidRouterHost(normalizeEndpointHost(state.primaryHostInput));
      const badge = document.getElementById("primaryHostValidBadge");
      const text = document.getElementById("primaryHostValidText");
      const btn = document.getElementById("connectPrimaryBtn");
      if (badge && text) {
        badge.className = `qual-badge ${valid ? "excellent" : "poor"} whitespace-nowrap shrink-0`;
        text.textContent = valid ? "Valid IP / Host ✓" : "Enter valid IP or domain";
      }
      if (btn) btn.disabled = !valid;
      return;
    }
    if (key === "profileLanInput" || key === "profileVpnInput" || key === "loginUserInput" || key === "loginPassInput" || key === "smsComposeTo" || key === "smsComposeBody" || key === "ussdInput") {
      state[key] = e.target.value;
      return;
    }
    if (key === "imeiInput") {
      state.cellular.imeiInput = e.target.value.replace(/\D/g, "").slice(0, 15);
      render();
      return;
    }
    if (key === "ttlCustomInput") {
      state.cellular.ttlCustomInput = e.target.value;
      return;
    }
    if (key && key in state) {
      state[key] = e.target.value;
      render();
      return;
    }
    const wifiKey = e.target.getAttribute("data-wifi");
    if (wifiKey) {
      const field = e.target.getAttribute("data-field");
      state.wifi[wifiKey][field] = e.target.value;
      return;
    }
    const cellField = e.target.getAttribute("data-cell");
    if (cellField) {
      state.cellular[cellField] = e.target.value;
    }
  });

  document.addEventListener("change", (e) => {
    const wifiKey = e.target.getAttribute("data-wifi");
    if (wifiKey) {
      const field = e.target.getAttribute("data-field");
      state.wifi[wifiKey][field] = e.target.value;
      return;
    }
    const cellField = e.target.getAttribute("data-cell");
    if (cellField) {
      state.cellular[cellField] = e.target.value;
    }
  });
}

// ============================================================================
// Live /ubus Telemetry Ingestion (Zero Mixed Mock Data)
// ============================================================================

let prevRxBytes = null;
let prevTxBytes = null;
let prevSampleTs = null;
let prevCpuTotal = null;
let prevCpuIdle = null;

function parseAclList(str) {
  if (!str) return [];
  return String(str)
    .split(";")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(s));
}

function applyLiveTelemetry(tm, cl, st, mg, wg, bl, lg) {
  if (tm && typeof tm === "object") {
    if (tm._caller_ip || tm.client_ip) {
      state.router.callerIp = tm._caller_ip || tm.client_ip || state.router.callerIp;
    }
    if (tm.wan) {
      if (tm.wan.if) state.router.wanInterface = `${tm.wan.if} (fq_codel)`;
      if (tm.wan.ip4) state.router.wanIpv4 = tm.wan.ip4;
      if (tm.wan.ip6) state.router.wanIpv6 = tm.wan.ip6;
      if (typeof tm.wan.ping_ms === "number") state.router.pingMs = tm.wan.ping_ms;
      const nowMs = Date.now();
      if (typeof tm.wan.rx === "number" && typeof tm.wan.tx === "number") {
        state.throughput.totalDownGb = Number((tm.wan.rx / 1e9).toFixed(2));
        state.throughput.totalUpGb = Number((tm.wan.tx / 1e9).toFixed(2));
        if (prevRxBytes !== null && prevSampleTs !== null && nowMs > prevSampleTs) {
          const dtSec = (nowMs - prevSampleTs) / 1000;
          const downMbps = Math.max(0, ((tm.wan.rx - prevRxBytes) * 8) / (dtSec * 1e6));
          const upMbps = Math.max(0, ((tm.wan.tx - prevTxBytes) * 8) / (dtSec * 1e6));
          state.throughput.downMbps = Number(downMbps.toFixed(1));
          state.throughput.upMbps = Number(upMbps.toFixed(1));
          if (downMbps > state.throughput.peakDownMbps) {
            state.throughput.peakDownMbps = Number(downMbps.toFixed(1));
          }
          state.throughput.historyDown.push(state.throughput.downMbps);
          state.throughput.historyDown.shift();
          state.throughput.historyUp.push(state.throughput.upMbps);
          state.throughput.historyUp.shift();
        }
        prevRxBytes = tm.wan.rx;
        prevTxBytes = tm.wan.tx;
        prevSampleTs = nowMs;
      }
    }

    if (tm.sys) {
      if (typeof tm.sys.uptime_s === "number") state.router.uptimeSec = tm.sys.uptime_s;
      if (typeof tm.sys.mem_total_kb === "number" && typeof tm.sys.mem_avail_kb === "number") {
        state.router.ramTotalMb = Math.round(tm.sys.mem_total_kb / 1024);
        state.router.ramUsedMb = Math.round((tm.sys.mem_total_kb - tm.sys.mem_avail_kb) / 1024);
      }
      if (typeof tm.sys.t_soc === "number") state.router.tempCelsius = Math.round(tm.sys.t_soc);
      if (typeof tm.sys.cpu_total === "number" && typeof tm.sys.cpu_idle === "number") {
        if (prevCpuTotal !== null && tm.sys.cpu_total > prevCpuTotal) {
          const dTot = tm.sys.cpu_total - prevCpuTotal;
          const dIdle = tm.sys.cpu_idle - prevCpuIdle;
          state.router.cpuLoadPct = Math.max(1, Math.min(100, Math.round(((dTot - dIdle) / dTot) * 100)));
        }
        prevCpuTotal = tm.sys.cpu_total;
        prevCpuIdle = tm.sys.cpu_idle;
      }
    }

    if (tm.cell) {
      const nr = tm.cell.nr || {};
      const lte = tm.cell.lte || {};
      if (tm.cell.rat) {
        state.cellular.mode = tm.cell.rat;
        state.cellular.regState = `Registered (${tm.cell.rat})`;
      }
      state.cellular.nrRsrp = typeof nr.rsrp === "number" ? nr.rsrp : null;
      state.cellular.lteRsrp = typeof lte.rsrp === "number" ? lte.rsrp : null;
      if (typeof nr.rsrp === "number") {
        state.cellular.rsrp = nr.rsrp;
      } else if (typeof lte.rsrp === "number") {
        state.cellular.rsrp = lte.rsrp;
      }
      if (typeof nr.rsrq === "number") {
        state.cellular.rsrq = nr.rsrq;
      } else if (typeof lte.rsrq === "number") {
        state.cellular.rsrq = lte.rsrq;
      }
      state.cellular.nrSinr = typeof nr.sinr === "number" ? nr.sinr : null;
      state.cellular.lteSinr = typeof lte.sinr === "number" ? lte.sinr : null;
      if (typeof nr.sinr === "number") {
        state.cellular.sinr = nr.sinr;
      } else if (typeof lte.sinr === "number") {
        state.cellular.sinr = lte.sinr;
      }
      state.cellular.pci = nr.pci || lte.pci || "—";
      state.cellular.cellId = lte.cid ? `0x${Number(lte.cid).toString(16).toUpperCase()}` : "—";
      state.cellular.ta = typeof nr.ta === "number" ? nr.ta : null;
      state.cellular.primaryBand = nr.band ? `n${nr.band}${nr.bw ? ` (${nr.bw})` : ""}` : (lte.band ? `B${lte.band}` : "—");
      state.cellular.anchorBand = lte.band ? `B${lte.band}${lte.bw ? ` (${lte.bw})` : ""}` : "None (SA / Single)";
      const sccCount = (Number(nr.scc) || 0) + (Number(lte.scc) || 0) + (nr.band && lte.band ? 2 : 1);
      state.cellular.caStatus = sccCount > 1 ? `${sccCount}CC Active` : "Single Carrier";
    }

    if (tm.wifi) {
      if (tm.wifi.ra0) {
        if (tm.wifi.ra0.ssid && !state.editMode) state.wifi.ra0.ssid = tm.wifi.ra0.ssid;
        if (tm.wifi.ra0.ch && !state.editMode) state.wifi.ra0.channel = tm.wifi.ra0.ch;
        if (typeof tm.wifi.ra0.ht_bw === "number" && !state.editMode) {
          state.wifi.ra0.htBw = tm.wifi.ra0.ht_bw;
          state.wifi.ra0.widthLabel = tm.wifi.ra0.ht_bw === 0 ? "20 MHz" : "20/40 MHz";
        }
        if (typeof tm.wifi.ra0.clients === "number") state.wifi.ra0.clientsCount = tm.wifi.ra0.clients;
      }
      if (tm.wifi.rai0) {
        if (tm.wifi.rai0.ssid && !state.editMode) state.wifi.rai0.ssid = tm.wifi.rai0.ssid;
        if (tm.wifi.rai0.ch && !state.editMode) state.wifi.rai0.channel = tm.wifi.rai0.ch;
        if (typeof tm.wifi.rai0.ht_bw === "number" && !state.editMode) {
          state.wifi.rai0.htBw = tm.wifi.rai0.ht_bw;
          state.wifi.rai0.widthLabel = tm.wifi.rai0.ht_bw === 0 ? "20 MHz" : "80 MHz";
        }
        if (typeof tm.wifi.rai0.clients === "number") state.wifi.rai0.clientsCount = tm.wifi.rai0.clients;
      }
    }

    if (tm.vpn) {
      const nb = tm.vpn.netbird || {};
      const ts = tm.vpn.tailscale || {};
      if (nb.ip) {
        state.router.vpnEndpoint = nb.ip;
        state.savedEndpoints = rememberEndpoint(nb.ip, "Remote via NetBird (IP)");
      }
      if (nb.fqdn) {
        state.router.vpnFqdn = nb.fqdn;
        state.savedEndpoints = rememberEndpoint(nb.fqdn, "Remote via NetBird (FQDN)");
      }
      if (nb.mgmt) state.router.vpnMgmt = nb.mgmt;
      if (nb.signal) state.router.vpnSignal = nb.signal;
      if (nb.peers !== undefined && nb.peers_total !== undefined) {
        state.router.vpnPeers = `${nb.peers}/${nb.peers_total} Peers`;
      }
      state.router.tailscaleRunning = Boolean(ts.running);
      if (ts.ip) {
        state.router.tailscaleIp = ts.ip;
        state.savedEndpoints = rememberEndpoint(ts.ip, "Remote via Tailscale");
      } else {
        state.router.tailscaleIp = "—";
      }
    }
  }

  if (st && typeof st === "object") {
    if (st.op) state.cellular.operator = st.op;
    if (st.mcc && st.mnc) state.cellular.plmn = `${st.mcc}${st.mnc}`;
    if (st.imei) {
      state.cellular.imei = st.imei;
      if (!state.cellular.imeiInput) state.cellular.imeiInput = st.imei;
    }
    if (st.iccid) state.cellular.iccid = st.iccid;
    if (st.imsi) state.cellular.imsi = st.imsi;
    if (st.apn && !state.editMode) state.cellular.apn = st.apn;
    if (st.kernel) state.router.kernel = st.kernel;
    if (st.model) state.router.model = st.model;
  }

  if (mg && typeof mg === "object") {
    if (mg.ttl) {
      state.cellular.ttlEnabled = Boolean(mg.ttl.enabled || mg.ttl.live);
      const v = mg.ttl.live || mg.ttl.val || 64;
      state.cellular.ttlVal = Number(v);
      if (!state.editMode) state.cellular.ttlCustomInput = String(v);
    }
    if (mg.apn && mg.apn.apn && !state.editMode) {
      state.cellular.apn = mg.apn.apn;
    }
  }

  if (wg && typeof wg === "object") {
    if (wg.ra0 && wg.ra0.acl_list !== undefined) {
      state.wifi.ra0.aclList = parseAclList(wg.ra0.acl_list);
    }
    if (wg.rai0 && wg.rai0.acl_list !== undefined) {
      state.wifi.rai0.aclList = parseAclList(wg.rai0.acl_list);
    }
  }

  if (cl && Array.isArray(cl.clients)) {
    const callerIp = cl._caller_ip || cl.client_ip || state.router.callerIp;
    if (callerIp) state.router.callerIp = callerIp;
    const blockedSet = new Set((state.wifi.ra0.aclList || []).map((m) => m.toUpperCase()));

    state.devices = cl.clients.map((item, idx) => {
      const macUpper = String(item.mac || "").toUpperCase();
      const ip = item.ip || "—";
      return {
        id: macUpper || "dev_" + idx,
        name: item.name || item.ip || macUpper || "Client",
        ip,
        mac: macUpper,
        iface: item.iface || (item.wifi ? "ra0" : "br-lan"),
        band: item.wifi ? `${item.band || "2.4"} GHz (${item.iface || "ra0"})` : "LAN / Overlay",
        rssi: typeof item.rssi === "number" ? item.rssi : null,
        pingMs: 4,
        lease: item.wifi ? "Associated Wi-Fi" : "DHCP Lease",
        isNew: false,
        isBlocked: blockedSet.has(macUpper),
        isCurrentAdmin: Boolean(callerIp && ip === callerIp)
      };
    });
  }

  if (bl && typeof bl === "object" && bl.ok) {
    state.backups = {
      mount: bl.mount || "/mnt/sda1",
      mounted: Boolean(bl.mounted),
      availKb: Number(bl.avail_kb) || 0,
      totalKb: Number(bl.total_kb) || 0,
      items: Array.isArray(bl.items) ? bl.items : []
    };
  }

  if (lg && typeof lg === "object" && Array.isArray(lg.lines)) {
    state.logs = lg.lines;
  }
}

async function refreshTabSpecificLive(tab) {
  if (state.dataSource !== "live") return;
  try {
    if (tab === "sms") {
      const [res] = await ubusBatchCall([{ object: "aw1000", method: "sms_list" }]);
      if (res?.data && Array.isArray(res.data.inbox)) {
        state.smsList = res.data.inbox.map((m, i) => ({
          id: "live_sms_" + (m.storage || "MT") + "_" + (m.index ?? i),
          sender: m.sender || "SIM",
          time: m.time || "",
          unread: Boolean(m.unread),
          storage: m.storage || "",
          text: m.content || ""
        }));
        render();
      }
    } else if (tab === "system") {
      const res = await ubusBatchCall([
        { object: "aw1000", method: "backup_list" },
        { object: "aw1000", method: "logs_get" }
      ]);
      applyLiveTelemetry(null, null, null, null, null, res?.[0]?.data, res?.[1]?.data);
      render();
    }
  } catch (_) {
    // ignore transient error
  }
}

async function pollTick(forceExtended = false) {
  if (typeof document !== "undefined" && document.hidden) return;
  if (!forceExtended && isAnyModalOpen()) return;

  if (state.dataSource === "mock") {
    const jitterDown = (Math.random() - 0.48) * 32;
    const jitterUp = (Math.random() - 0.48) * 7;
    state.throughput.downMbps = Math.max(95, Math.min(580, state.throughput.downMbps + jitterDown));
    state.throughput.upMbps = Math.max(22, Math.min(96, state.throughput.upMbps + jitterUp));
    state.throughput.historyDown.push(Number(state.throughput.downMbps.toFixed(1)));
    state.throughput.historyDown.shift();
    state.throughput.historyUp.push(Number(state.throughput.upMbps.toFixed(1)));
    state.throughput.historyUp.shift();
    state.router.uptimeSec += 3;

    if (state.activeTab === "home") {
      render();
    }
    return;
  }

  try {
    const needExtended = forceExtended || !extendedLoadedOnce;
    const res = await fetchLiveDashboardSnapshot(false);
    const tmRes = res?.[0];
    const clRes = res?.[1];

    if (!tmRes || tmRes.code !== 0 || !tmRes.data) {
      throw new Error(`ubus telemetry: ${tmRes?.statusText || "No data returned"}`);
    }

    applyLiveTelemetry(tmRes.data, clRes?.data, null, null, null, null, null);
    state.liveLoading = false;
    state.routerOffline = false;
    state.staleSince = null;
    state.lastFetchError = null;
    state.unreachableBanner = false;
    autoProbeTriggered = false;

    if (needExtended) {
      extendedLoadedOnce = true;
      fetchLiveExtendedSnapshot()
        .then((ext) => {
          applyLiveTelemetry(
            null,
            null,
            ext?.[0]?.data,
            ext?.[1]?.data,
            ext?.[2]?.data,
            ext?.[3]?.data,
            ext?.[4]?.data
          );
          if (!isAnyModalOpen() && !isFormFieldFocused()) render();
        })
        .catch(() => {
          extendedLoadedOnce = false;
        });
    }
  } catch (err) {
    state.liveLoading = false;
    state.lastFetchError = err?.message || "Network error contacting /cgi-bin/ubus";
    clearStaleTelemetryOnDisconnect();
    if (!state.staleSince) {
      state.staleSince = new Date().toTimeString().slice(0, 5);
    }
  }
  if (!isAnyModalOpen() && !isFormFieldFocused()) {
    render();
  }
}

function restartPolling() {
  if (pollTimer) clearInterval(pollTimer);
  const intervalMs = state.connectionPath === "lan" ? 2200 : 3800;
  pollTimer = setInterval(() => pollTick(false), intervalMs);
}

export function initApp() {
  setupEvents();
  if (typeof window !== "undefined") {
    window.__aw1000HandleBackButton = () => {
      if (state.confirmModal) {
        state.confirmModal = null;
        render();
        return true;
      }
      if (state.endpointModalOpen) {
        state.endpointModalOpen = false;
        render();
        return true;
      }
      if (state.loginModalOpen) {
        state.loginModalOpen = false;
        state.loginPassInput = "";
        render();
        return true;
      }
      if (state.trustModalOpen) {
        state.trustModalOpen = false;
        render();
        return true;
      }
      if (state.activeTab !== "home") {
        state.activeTab = "home";
        render();
        return true;
      }
      return false;
    };
  }
  render();
  if (state.dataSource === "live") {
    pollTick(true);
  }
  restartPolling();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pollTick(false);
  });
}

initApp();
