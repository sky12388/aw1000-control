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
    if (!btn || btn.getAttribute('data-rgb-bound') === '1' || window.__rgbThemeToggleBound) return;
    btn.setAttribute('data-rgb-bound', '1');
    window.__rgbThemeToggleBound = true;

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
    var bg = backgroundOf(el);
    if (contrast(fg, bg) >= 4.2) return;
    // Choose high-contrast foreground based on the ACTUAL rendered background luminance
    var bgIsLight = luminance(bg) > 0.42;
    el.style.setProperty('color', bgIsLight ? '#0f172a' : '#f8fafc', 'important');
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

  /* System -> Startup Initscripts Enhancer: Default A-Z sort + Sort Toggle + Live Search */
  function isStartupPage() {
    var path = (window.location && window.location.pathname) || '';
    var page = (document.body && document.body.getAttribute('data-page')) || '';
    return path.indexOf('/system/startup') !== -1 || page === 'admin-system-startup';
  }

  function enhanceStartupTable() {
    if (!isStartupPage()) return;
    var tab = document.querySelector('[data-tab="init"]') || document;
    var table = tab.querySelector('.table') || tab.querySelector('table');
    if (!table || table.getAttribute('data-rgb-startup-init') === '1') return;

    var getRows = function () {
      var list = table.querySelectorAll('.tr:not(.table-titles)');
      if (!list.length) list = table.querySelectorAll('tbody tr');
      return Array.prototype.slice.call(list).filter(function (r) {
        return !r.classList.contains('table-titles') && !r.querySelector('th, .th');
      });
    };

    var rows = getRows();
    if (!rows.length) return;

    table.setAttribute('data-rgb-startup-init', '1');

    var getCells = function (row) {
      var c = row.querySelectorAll(':scope > .td');
      if (!c.length) c = row.querySelectorAll('td');
      return c;
    };

    var sortMode = 'alpha'; // Default: alphabetical A-Z by service name

    var bar = document.createElement('div');
    bar.id = 'rgb-startup-bar';
    bar.className = 'rgb-startup-bar';
    bar.innerHTML =
      '<div class="rgb-startup-search-wrap">' +
        '<input type="search" id="rgb-startup-search" class="rgb-startup-input" ' +
          'placeholder="Search initscripts (e.g. netbird, tailscale, adguard, fibocom)..." autocomplete="off" />' +
        '<button type="button" id="rgb-startup-clear" class="btn rgb-startup-btn" title="Clear search">Clear</button>' +
      '</div>' +
      '<div class="rgb-startup-controls">' +
        '<button type="button" id="rgb-startup-sort" class="btn rgb-startup-btn rgb-startup-sort-btn">Sort: A–Z</button>' +
        '<span id="rgb-startup-count" class="rgb-startup-count"></span>' +
      '</div>';

    table.parentNode.insertBefore(bar, table);

    var searchInput = bar.querySelector('#rgb-startup-search');
    var clearBtn = bar.querySelector('#rgb-startup-clear');
    var sortBtn = bar.querySelector('#rgb-startup-sort');
    var countEl = bar.querySelector('#rgb-startup-count');

    function applySortAndFilter() {
      var curRows = getRows();
      var parent = curRows[0] ? curRows[0].parentNode : table;
      curRows.sort(function (a, b) {
        var ca = getCells(a), cb = getCells(b);
        var pa = parseInt((ca[0] && ca[0].textContent) || '999', 10);
        var pb = parseInt((cb[0] && cb[0].textContent) || '999', 10);
        var na = ((ca[1] && ca[1].textContent) || '').trim().toLowerCase();
        var nb = ((cb[1] && cb[1].textContent) || '').trim().toLowerCase();
        if (sortMode === 'priority') {
          if (pa !== pb) return pa - pb;
          return na.localeCompare(nb);
        }
        var cmp = na.localeCompare(nb);
        return cmp !== 0 ? cmp : (pa - pb);
      });

      var q = (searchInput.value || '').trim().toLowerCase();
      var shown = 0;
      for (var i = 0; i < curRows.length; i++) {
        var row = curRows[i];
        parent.appendChild(row);
        var cells = getCells(row);
        var prio = ((cells[0] && cells[0].textContent) || '').trim().toLowerCase();
        var name = ((cells[1] && cells[1].textContent) || '').trim().toLowerCase();
        var match = !q || name.indexOf(q) !== -1 || prio.indexOf(q) !== -1;
        row.style.display = match ? '' : 'none';
        if (match) {
          shown++;
          row.classList.remove('cbi-rowstyle-1', 'cbi-rowstyle-2');
          row.classList.add((shown % 2 === 1) ? 'cbi-rowstyle-1' : 'cbi-rowstyle-2');
        }
      }
      sortBtn.textContent = (sortMode === 'alpha') ? 'Sort: A–Z' : 'Sort: Boot Priority';
      countEl.textContent = shown + ' / ' + curRows.length + ' services';
      clearBtn.disabled = !q;
    }

    searchInput.addEventListener('input', applySortAndFilter);
    clearBtn.addEventListener('click', function () {
      searchInput.value = '';
      applySortAndFilter();
      searchInput.focus();
    });
    sortBtn.addEventListener('click', function () {
      sortMode = (sortMode === 'alpha') ? 'priority' : 'alpha';
      applySortAndFilter();
    });

    applySortAndFilter();
  }

  function mountSkywalkerBranding() {
    var URL = 'https://sky12388.github.io/aw1000-control/';
    var HTML = '<span>AW1000_5G_ULTRA</span><span>·</span>'
      + '<a href="' + URL + '" target="_blank" rel="noopener noreferrer"><strong>Developed by Skywalker</strong></a>'
      + '<a class="rgb-apk-badge" href="' + URL + '" target="_blank" rel="noopener noreferrer">Download Android APK ↗</a>';
    if (!document.getElementById('rgb-skywalker-footer')) {
      var foot = document.createElement('div');
      foot.id = 'rgb-skywalker-footer';
      foot.className = 'rgb-skywalker-footer';
      foot.innerHTML = HTML;
      var footerEl = document.querySelector('footer');
      if (footerEl) footerEl.appendChild(foot);
      else if (document.body) document.body.appendChild(foot);
    }
    var pwInput = document.querySelector('input[name="luci_password"]');
    if (pwInput && !document.getElementById('rgb-skywalker-login')) {
      var form = pwInput.closest('form') || pwInput.parentElement;
      if (form) {
        var badge = document.createElement('div');
        badge.id = 'rgb-skywalker-login';
        badge.className = 'rgb-skywalker-login';
        badge.innerHTML = HTML;
        form.insertBefore(badge, form.firstChild);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    mountThemeToggle();
    mountSkywalkerBranding();
    enhanceStartupTable();
    scan(document);
    var observer = new MutationObserver(function (records) {
      enhanceStartupTable();
      mountSkywalkerBranding();
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
