/* AW1000 RGB Ultra Theme for OpenWrt LuCI — Dark/Light Toggle + WCAG Contrast Guard */
(function () {
  'use strict';

  var t = 'dark';
  try { t = localStorage.getItem('rgb-theme') || 'dark'; } catch (e) {}
  if (t !== 'dark' && t !== 'light') t = 'dark';
  document.documentElement.setAttribute('data-theme', t);

  function mountThemeToggle() {
    var btn = document.getElementById('rgb-theme-toggle');
    if (!btn) {
      var container = document.querySelector('header .fill .container')
        || document.querySelector('header .container')
        || document.querySelector('header');
      if (container) {
        var wrap = document.createElement('div');
        wrap.className = 'rgb-theme-control';
        btn = document.createElement('button');
        btn.id = 'rgb-theme-toggle';
        btn.type = 'button';
        btn.className = 'rgb-theme-toggle';
        btn.setAttribute('aria-pressed', 'true');
        btn.title = 'Toggle Dark / Light Mode';
        btn.textContent = 'Dark / Light';
        wrap.appendChild(btn);
        container.appendChild(wrap);
      }
    }
    if (!btn || btn.getAttribute('data-rgb-bound') === '1') return;
    btn.setAttribute('data-rgb-bound', '1');

    function sync() {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
      btn.title = dark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
      btn.textContent = dark ? 'Dark / Light' : 'Light / Dark';
    }
    sync();
    btn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('rgb-theme', next); } catch (e) {}
      sync();
      if (window.__rgbContrastReset) window.__rgbContrastReset();
    });
  }

  /* Lightweight contrast audit: overrides low-contrast inline colors on
     dynamically injected LuCI content (including 3gdetail AJAX updates). */
  var MARK = 'data-rgb-contrast';
  var queued = false;
  var SEL = '.ginfo-dashboard *, .ginfo-page *, #operator, #operator *, #location, .cbi-value *, .cbi-map *, .cbi-section *, td, th, span, div, p, strong, label';

  function parseColor(v) {
    if (!v) return null;
    v = String(v).trim();
    var m = v.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
      if (p.length < 3 || p.some(function (n) { return isNaN(n); })) return null;
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    m = v.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) {
        h = h.split('').map(function (c) { return c + c; }).join('');
      }
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
        h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
      ];
    }
    return v === 'transparent' ? [0, 0, 0, 0] : null;
  }

  function luminance(c) {
    var f = c.slice(0, 3).map(function (n) {
      n /= 255;
      return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }

  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  function backgroundOf(el) {
    var n = el;
    while (n && n.nodeType === 1) {
      var c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c[3] >= 0.55) return c;
      n = n.parentElement;
    }
    return document.documentElement.getAttribute('data-theme') === 'light'
      ? [238, 242, 247, 1] : [7, 11, 24, 1];
  }

  function ownText(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3 && el.childNodes[i].nodeValue.trim()) return true;
    }
    return false;
  }

  function enforce(el) {
    if (!el || el.nodeType !== 1 || el.hasAttribute(MARK)) return;
    if (!el.textContent || !el.textContent.trim() || !ownText(el)) return;
    var fg = parseColor(getComputedStyle(el).color);
    if (!fg || fg[3] < 0.5) return;
    if (contrast(fg, backgroundOf(el)) >= 3.2) return;
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    el.style.setProperty('color', dark ? '#f8fafc' : '#0f172a', 'important');
    el.setAttribute(MARK, '1');
  }

  function scan(root) {
    var scope = (root && root.querySelectorAll) ? root : document;
    var nodes = scope.querySelectorAll(SEL);
    for (var i = 0; i < nodes.length; i++) enforce(nodes[i]);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; scan(document); });
  }

  window.__rgbContrastReset = function () {
    var marked = document.querySelectorAll('[' + MARK + ']');
    for (var i = 0; i < marked.length; i++) {
      marked[i].style.removeProperty('color');
      marked[i].removeAttribute(MARK);
    }
    schedule();
  };

  document.addEventListener('DOMContentLoaded', function () {
    mountThemeToggle();
    scan(document);
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var target = records[i].target;
        if (target && target.nodeType === 1 && target.hasAttribute(MARK)) continue;
        schedule();
        break;
      }
    });
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }
  });

  window.addEventListener('poll-start', schedule);
  window.addEventListener('uci-new-changes', schedule);
})();
