(() => {
  "use strict";

  const SIGNAL_TIERS = [
    { step: 1,  pct: 10,  rsrp: -120, sinr: -2, ta: 19, color: "#18181B", glow: "rgba(113,113,122,0.5)", label: "Weak Signal" },
    { step: 2,  pct: 20,  rsrp: -116, sinr: 1,  ta: 16, color: "#EF4444", glow: "rgba(239,68,68,0.5)",   label: "Weak Signal" },
    { step: 3,  pct: 30,  rsrp: -113, sinr: 3,  ta: 14, color: "#EAB308", glow: "rgba(234,179,8,0.5)",   label: "Weak Signal" },
    { step: 4,  pct: 40,  rsrp: -107, sinr: 6,  ta: 12, color: "#F59E0B", glow: "rgba(245,158,11,0.5)",  label: "Fair Signal" },
    { step: 5,  pct: 50,  rsrp: -102, sinr: 10, ta: 10, color: "#F97316", glow: "rgba(249,115,22,0.5)",  label: "Fair Signal" },
    { step: 6,  pct: 60,  rsrp: -97,  sinr: 14, ta: 8,  color: "#84CC16", glow: "rgba(132,204,22,0.5)",  label: "Good Signal" },
    { step: 7,  pct: 70,  rsrp: -93,  sinr: 18, ta: 7,  color: "#10B981", glow: "rgba(16,185,129,0.5)",  label: "Good Signal" },
    { step: 8,  pct: 80,  rsrp: -89,  sinr: 22, ta: 6,  color: "#14B8A6", glow: "rgba(20,184,166,0.5)",  label: "Good Signal" },
    { step: 9,  pct: 90,  rsrp: -84,  sinr: 26, ta: 5,  color: "#06B6D4", glow: "rgba(6,182,212,0.5)",   label: "Excellent Signal" },
    { step: 10, pct: 100, rsrp: -78,  sinr: 30, ta: 4,  color: "#00E676", glow: "rgba(0,230,118,0.55)",  label: "Excellent Signal" }
  ];

  const OS_INSTRUCTIONS = {
    windows: {
      title: "Windows 10 / 11 (PowerShell or Windows Terminal)",
      step1: "1. Connect your PC to the AW1000 Wi-Fi or LAN cable, open PowerShell, and log in:",
      sshCmd: "ssh root@192.168.1.1",
      step2: "2. Once logged into the router, paste this 1-command installer:"
    },
    macos: {
      title: "macOS (Terminal.app)",
      step1: "1. Connect your Mac to the AW1000 Wi-Fi or Ethernet, open Terminal, and log in:",
      sshCmd: "ssh root@192.168.1.1",
      step2: "2. Once logged into the router, paste this 1-command installer:"
    },
    linux: {
      title: "Linux (Ubuntu / Debian / Arch / Fedora)",
      step1: "1. Connect to your AW1000 LAN or overlay VPN, open your terminal, and SSH in:",
      sshCmd: "ssh root@192.168.1.1",
      step2: "2. Once logged into the router, paste this 1-command installer:"
    },
    termux: {
      title: "Android (Termux — No PC Required)",
      step1: "1. Install Termux, run `pkg install openssh`, connect to AW1000 Wi-Fi, and SSH in:",
      sshCmd: "ssh root@192.168.1.1",
      step2: "2. Once logged into the router, paste this 1-command installer:"
    }
  };

  let currentStep = 10;
  let audioCtx = null;

  function renderPreview(stepNum) {
    currentStep = Math.max(1, Math.min(10, Number(stepNum) || 10));
    const tier = SIGNAL_TIERS[currentStep - 1];

    const pctEl = document.getElementById("previewPct");
    const labelEl = document.getElementById("previewLabel");
    const rsrpEl = document.getElementById("previewRsrp");
    const sinrEl = document.getElementById("previewSinr");
    const distEl = document.getElementById("previewDist");
    const stageEl = document.getElementById("previewBars");

    if (pctEl) {
      pctEl.textContent = `${tier.pct}%`;
      pctEl.style.color = tier.step === 1 ? "#E4E4E7" : tier.color;
    }
    if (labelEl) {
      labelEl.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${tier.color};display:inline-block;"></span> ${tier.label} · Bar ${tier.step}/10`;
    }
    if (rsrpEl) rsrpEl.textContent = `${tier.rsrp} dBm`;
    if (sinrEl) sinrEl.textContent = `${tier.sinr} dB`;
    if (distEl) distEl.textContent = `${Math.round(tier.ta * 39.06)} m (TA ${tier.ta})`;

    if (stageEl) {
      stageEl.innerHTML = SIGNAL_TIERS.map((b) => {
        const lit = b.step <= tier.step;
        const isCurrent = b.step === tier.step;
        const h = 20 + b.step * 8;
        const border = b.step === 1 ? "border-color:#52525B;" : "";
        const style = lit
          ? `height:${h}%;background:${tier.color};box-shadow:0 0 12px -1px ${tier.glow};${border}`
          : `height:${h}%;background:${b.color};${border}`;
        return `
          <div class="bar-col">
            <div class="bar-fill ${lit ? "lit" : ""}" style="${style}"></div>
            <span class="bar-tick tabular ${isCurrent ? "current" : ""}">${b.pct}</span>
          </div>
        `;
      }).join("");
    }
  }

  function playPreviewBeep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const score = (currentStep - 1) / 9;
      const freq = Math.round(600 + score * 800);
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.32, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
      navigator.vibrate?.(40);
    } catch (_) {}
  }

  function selectOsTab(osKey) {
    const info = OS_INSTRUCTIONS[osKey] || OS_INSTRUCTIONS.windows;
    document.querySelectorAll(".os-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-os") === osKey);
    });
    const titleEl = document.getElementById("osTitle");
    const step1El = document.getElementById("osStep1");
    const sshEl = document.getElementById("osSshCmd");
    const step2El = document.getElementById("osStep2");
    if (titleEl) titleEl.textContent = info.title;
    if (step1El) step1El.textContent = info.step1;
    if (sshEl) sshEl.textContent = info.sshCmd;
    if (step2El) step2El.textContent = info.step2;
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderPreview(10);
    selectOsTab("windows");

    const slider = document.getElementById("signalSlider");
    if (slider) {
      slider.addEventListener("input", (e) => {
        renderPreview(e.target.value);
      });
    }

    const beepBtn = document.getElementById("previewBeepBtn");
    if (beepBtn) {
      beepBtn.addEventListener("click", playPreviewBeep);
    }

    document.querySelectorAll(".os-tab").forEach((btn) => {
      btn.addEventListener("click", () => selectOsTab(btn.getAttribute("data-os")));
    });

    document.querySelectorAll("[data-copy-target]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-copy-target");
        const el = document.getElementById(id);
        if (!el) return;
        try {
          await navigator.clipboard.writeText(el.textContent.trim());
          const orig = btn.textContent;
          btn.textContent = "Copied ✓";
          btn.classList.add("copied");
          setTimeout(() => {
            btn.textContent = orig;
            btn.classList.remove("copied");
          }, 1800);
        } catch (_) {}
      });
    });
  });
})();
