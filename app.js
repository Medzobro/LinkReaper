/* ═══════════════════════════════════════════════════════
   LinkReaper v4.1 — app.js
   UI state, rendering, language switching, history
   FIXES vs v4:
   - currentLang exposed on window for engine.js access
   - typeText: clears timer properly (no ghost intervals)
   - renderResult: lastResult stored before render
   - addHistory: uses sessionStorage for persistence
   - animateRing: uses CSS var --ring-circ consistently
   - setLang: updates placeholder attribute too
   - doShare: fallback copies to clipboard with user feedback
   - engLayer active class toggled properly
═══════════════════════════════════════════════════════ */

/* ── STATE ── */
window.currentLang = 'ar';   // shared with engine.js
let lastResult   = null;
let scanHistory  = [];
let isScanning   = false;
let _typeTimer   = null;

/* ═══════════════════════════════════════════════════════
   PARTICLES
═══════════════════════════════════════════════════════ */
function initParticles() {
  const c = document.getElementById('pts');
  const count = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 20;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'pt';
    p.style.cssText = [
      `right:${Math.random() * 100}%`,
      `animation-duration:${8 + Math.random() * 12}s`,
      `animation-delay:${Math.random() * 10}s`,
      `width:${1 + Math.random() * 2}px`,
      `height:${1 + Math.random() * 2}px`,
    ].join(';');
    c.appendChild(p);
  }
}

/* ═══════════════════════════════════════════════════════
   TYPING EFFECT
═══════════════════════════════════════════════════════ */
function typeText(el, txt, spd = 24) {
  return new Promise(resolve => {
    if (_typeTimer) { clearInterval(_typeTimer); _typeTimer = null; }
    el.innerHTML = '<span class="tc"></span>';
    let i = 0;
    _typeTimer = setInterval(() => {
      if (i < txt.length) {
        el.innerHTML = escH(txt.slice(0, ++i)) + '<span class="tc"></span>';
      } else {
        clearInterval(_typeTimer);
        _typeTimer = null;
        el.innerHTML = escH(txt) + '<span class="tc"></span>';
        resolve();
      }
    }, spd);
  });
}

/* ═══════════════════════════════════════════════════════
   SCORE RING ANIMATION
═══════════════════════════════════════════════════════ */
const RING_CIRC = 213.628; // 2 * PI * r(34)
const LEVEL_COLORS = { safe: '#00FF88', warning: '#FFB300', danger: '#FF2244' };

function animateRing(score, level) {
  const fill   = document.getElementById('ringFill');
  const numEl  = document.getElementById('ringNum');
  const color  = LEVEL_COLORS[level] || LEVEL_COLORS.danger;

  fill.style.stroke = color;
  numEl.style.color = color;

  /* Animate stroke-dashoffset */
  const targetOffset = RING_CIRC - (RING_CIRC * score / 100);
  fill.style.strokeDashoffset = RING_CIRC; // reset first
  requestAnimationFrame(() => {
    fill.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.34,1.2,.64,1), stroke .3s';
    fill.style.strokeDashoffset = targetOffset;
  });

  /* Count up number */
  const t0 = performance.now();
  (function step(now) {
    const p = Math.min((now - t0) / 1000, 1);
    const e = 1 - Math.pow(1 - p, 3);
    numEl.textContent = Math.round(score * e);
    if (p < 1) requestAnimationFrame(step);
  })(performance.now());
}

function setRingStatic(score, level) {
  const fill  = document.getElementById('ringFill');
  const numEl = document.getElementById('ringNum');
  const color = LEVEL_COLORS[level] || LEVEL_COLORS.danger;

  fill.style.transition = 'none';
  fill.style.stroke = color;
  fill.style.strokeDashoffset = RING_CIRC - (RING_CIRC * score / 100);
  numEl.textContent = score;
  numEl.style.color = color;
}

/* ═══════════════════════════════════════════════════════
   ENGINE LAYER HELPERS
═══════════════════════════════════════════════════════ */
function setLayer(idx, state, msg = '') {
  const L    = TRANSLATIONS[window.currentLang];
  const badge  = document.getElementById('eb' + idx);
  const status = document.getElementById('es' + idx);
  const layer  = document.getElementById('el' + idx);

  const MAP = {
    waiting:   { cls: 'waiting',   txt: 'WAITING'  },
    running:   { cls: 'running',   txt: '...'      },
    ok:        { cls: 'done-ok',   txt: L.done     },
    warn:      { cls: 'done-warn', txt: '⚠️'       },
    bad:       { cls: 'done-bad',  txt: '🚨'       },
    skip:      { cls: 'done-skip', txt: L.skip     },
    err:       { cls: 'err',       txt: L.err      },   // FIX: was missing
  };

  const s = MAP[state] || MAP.waiting;
  badge.className = 'eng-badge ' + s.cls;
  badge.textContent = s.txt;
  if (status && msg) status.textContent = msg;

  /* Highlight active layer */
  if (layer) layer.classList.toggle('active', state === 'running');
}

function setProgress(pct) {
  document.getElementById('progFill').style.width = pct + '%';
}

/* ═══════════════════════════════════════════════════════
   LANGUAGE SWITCHER
═══════════════════════════════════════════════════════ */
function setLang(l) {
  window.currentLang = l;
  const L = TRANSLATIONS[l];
  const html = document.documentElement;
  html.setAttribute('lang', l);
  html.setAttribute('dir', L.dir);

  /* Lang button active state */
  document.querySelectorAll('.lbtn').forEach(b => {
    b.classList.toggle('on', b.getAttribute('onclick').includes(`'${l}'`));
  });

  /* Static UI text */
  _setText('tagline',      L.tagline);
  _setText('inputLabel',   L.inputLabel);
  _setText('engTitle',     L.engTitle);
  _setText('srcTitle',     L.srcTitle);
  _setText('chkTitle',     L.chkTitle);
  _setText('histLbl',      L.histLbl);
  _setText('bannerTitle',  L.bannerTitle);
  _setText('bannerDesc',   L.bannerDesc);
  _setText('xTxt',         L.xTxt);
  _setText('tgTxt',        L.tgTxt);
  _setText('shareTxt',     L.share);
  _setText('disclaimerEl', L.disclaimer);
  _setText('scanBtnTxt',   L.scanBtn);

  /* FIX: update placeholder */
  const inp = document.getElementById('urlInput');
  if (inp) inp.placeholder = L.inputPlaceholder || 'https://example.com';

  /* Footer */
  const footer = document.getElementById('footerEl');
  if (footer) footer.innerHTML = `${escH(L.footer)} &nbsp;•&nbsp; <span>${escH(L.footerSub)}</span>`;

  /* Engine step labels */
  for (let i = 0; i < 5; i++) {
    const el = document.getElementById('lt' + i);
    if (el) el.textContent = L.engStatus[i] || '';
    /* Clear status text */
    const es = document.getElementById('es' + i);
    if (es) es.textContent = '';
  }

  /* Monster */
  document.getElementById('monAv').textContent = '💀';
  typeText(document.getElementById('monTxt'), L.idle);

  /* Tips card — update if visible */
  const tc = document.getElementById('tipsCard');
  if (tc && tc.style.display !== 'none') {
    _setTipsCard(L);
  }

  /* Re-render result if exists */
  if (lastResult) {
    renderResult(lastResult.score, lastResult.level, lastResult.apiResults,
                 lastResult.hChecks, lastResult.domain, lastResult.rawUrl, false);
  }

  renderHistory();
}

function _setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

function _setTipsCard(L) {
  const tc = document.getElementById('tipsCard');
  const parts = L.tips.split(':');
  tc.innerHTML = `<strong>${escH(parts[0])}:</strong>${escH(parts.slice(1).join(':'))}`;
}

/* ═══════════════════════════════════════════════════════
   MAIN SCAN ORCHESTRATOR
═══════════════════════════════════════════════════════ */
async function startScan() {
  if (isScanning) return;

  const L   = TRANSLATIONS[window.currentLang];
  const raw = document.getElementById('urlInput').value.trim();

  if (!raw) {
    const inp = document.getElementById('urlInput');
    inp.style.borderColor = 'var(--neon)';
    inp.style.boxShadow   = 'var(--shadow-red)';
    typeText(document.getElementById('monTxt'), L.empty);
    setTimeout(() => { inp.style.borderColor = ''; inp.style.boxShadow = ''; }, 900);
    return;
  }

  /* Validate basic URL format */
  const urlCheck = parseURL(raw);
  if (!urlCheck.ok) {
    typeText(document.getElementById('monTxt'), L.empty);
    return;
  }

  isScanning = true;
  document.getElementById('scanBtn').disabled = true;
  document.getElementById('resCard').style.display = 'none';
  document.getElementById('tipsCard').style.display = 'none';

  /* Show engine card */
  const ec = document.getElementById('engineCard');
  ec.style.display = 'block';
  for (let i = 0; i < 5; i++) {
    setLayer(i, 'waiting');
    const es = document.getElementById('es' + i);
    if (es) es.textContent = '';
  }
  setProgress(0);

  const { domain } = urlCheck;
  document.getElementById('monAv').textContent = '🔍';
  typeText(document.getElementById('monTxt'), L.running, 18);

  const apiResults = [];

  /* ── Layer 0: Heuristics ── */
  setLayer(0, 'running', L.running);
  const hResult = runHeuristics(raw);
  await sleep(350);
  const hState = hResult.score >= 72 ? 'ok' : hResult.score >= 42 ? 'warn' : 'bad';
  setLayer(0, hState, `Score: ${hResult.score}/100`);
  setProgress(20);

  /* ── Layer 1: Google Safe Browsing ── */
  setLayer(1, 'running', L.running);
  typeText(document.getElementById('monTxt'), L.engStatus[1] + '...', 16);
  const gsbRes = await checkGSB(raw);
  setLayer(1, gsbRes.status, gsbRes.detail);
  apiResults.push({ name: 'Google Safe Browsing', icon: '🛡️', res: gsbRes });
  setProgress(40);

  /* ── Layer 2: URLScan ── */
  setLayer(2, 'running', L.running + ' (10–25s)');
  typeText(document.getElementById('monTxt'), L.engStatus[2] + '...', 16);
  const urlRes = await checkURLScan(raw);
  setLayer(2, urlRes.status, urlRes.detail);
  apiResults.push({ name: 'URLScan.io', icon: '🔬', res: urlRes });
  setProgress(60);

  /* ── Layer 3: AbuseIPDB ── */
  setLayer(3, 'running', L.running);
  typeText(document.getElementById('monTxt'), L.engStatus[3] + '...', 16);
  const ipRes = await checkAbuseIPDB(domain);
  setLayer(3, ipRes.status, ipRes.detail);
  apiResults.push({ name: 'AbuseIPDB', icon: '🌐', res: ipRes });
  setProgress(80);

  /* ── Layer 4: PhishStats ── */
  setLayer(4, 'running', L.running);
  typeText(document.getElementById('monTxt'), L.engStatus[4] + '...', 16);
  const phishRes = await checkPhishStats(raw);
  setLayer(4, phishRes.status, phishRes.detail);
  apiResults.push({ name: 'PhishStats', icon: '🎣', res: phishRes });
  setProgress(100);

  await sleep(250);
  ec.style.display = 'none';

  /* ── Aggregate final score ── */
  const finalScore = aggregateScore(hResult.score, apiResults);
  const level      = scoreToLevel(finalScore);

  /* Store result */
  lastResult = { score: finalScore, level, apiResults, hChecks: hResult.checks, domain, rawUrl: raw };

  renderResult(finalScore, level, apiResults, hResult.checks, domain, raw, true);
  addHistory(raw, level, finalScore);

  isScanning = false;
  document.getElementById('scanBtn').disabled = false;
}

/* ═══════════════════════════════════════════════════════
   RENDER RESULT
═══════════════════════════════════════════════════════ */
function renderResult(score, level, apiResults, hChecks, domain, rawUrl, animate) {
  const L    = TRANSLATIONS[window.currentLang];
  const card = document.getElementById('resCard');

  card.className    = level;
  card.style.display = 'block';

  /* Score ring */
  if (animate) {
    animateRing(score, level);
  } else {
    setRingStatic(score, level);
  }

  /* Verdict + domain */
  document.getElementById('resVerdict').textContent = L.verdict[level];
  document.getElementById('resDomain').textContent  = domain || rawUrl;

  /* Threat tags */
  const tagList = _buildThreatTags(apiResults, level);
  document.getElementById('threatTags').innerHTML = tagList
    .map(t => `<div class="ttag ${t.cls}">${escH(t.txt)}</div>`)
    .join('');

  /* AI Verdict */
  const vArr    = L.ai[level];
  const verdict = vArr[Math.floor(Math.random() * vArr.length)](domain || rawUrl, score);
  document.getElementById('aiVerdict').textContent = verdict;

  /* API Source cards */
  document.getElementById('srcGrid').innerHTML = apiResults.map(a => {
    const pillMap = { ok: 'pill-safe', warn: 'pill-warn', bad: 'pill-bad', skip: 'pill-skip', err: 'pill-err' };
    const pillTxt = { ok: '✅ CLEAN', warn: '⚠️ WARN', bad: '🚨 THREAT', skip: '— SKIP', err: '⚠️ ERR' };
    const cls = pillMap[a.res.status] || 'pill-skip';
    const txt = pillTxt[a.res.status] || '—';
    return `
      <div class="src-card">
        <div class="src-icon">${a.icon}</div>
        <div class="src-info">
          <div class="src-name">${escH(a.name)}</div>
          <div class="src-detail">${escH(a.res.detail || '—')}</div>
        </div>
        <div class="src-pill ${cls}">${txt}</div>
      </div>`;
  }).join('');

  /* Heuristic checks */
  document.getElementById('chkGrid').innerHTML = hChecks.map(c => `
    <div class="ci ${c.cls}">
      <span>${c.cls === 'chk-ok' ? '✅' : c.cls === 'chk-warn' ? '⚠️' : '❌'}</span>
      <span>${escH(c.txt)}</span>
    </div>`).join('');

  /* Tips */
  if (level === 'danger') {
    _setTipsCard(L);
    document.getElementById('tipsCard').style.display = 'block';
  } else {
    document.getElementById('tipsCard').style.display = 'none';
  }

  /* Monster reaction */
  document.getElementById('monAv').textContent = level === 'safe' ? '😌' : level === 'warning' ? '😒' : '😱';
  typeText(document.getElementById('monTxt'), L.monReact[level], 22);

  if (animate) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _buildThreatTags(apiResults, level) {
  const tags = [];
  apiResults.forEach(a => {
    if (a.res.status === 'bad') {
      if (a.name.includes('Google'))  tags.push({ cls: 'malware',    txt: 'MALWARE/PHISHING' });
      if (a.name.includes('URLScan')) tags.push({ cls: 'malware',    txt: 'MALICIOUS SITE'   });
      if (a.name.includes('Abuse'))   tags.push({ cls: 'abuse',      txt: 'IP ABUSE'         });
      if (a.name.includes('Phish'))   tags.push({ cls: 'phishing',   txt: 'PHISHING DB'      });
    }
    if (a.res.status === 'warn') tags.push({ cls: 'suspicious', txt: 'SUSPICIOUS' });
  });
  if (!tags.length) {
    tags.push({ cls: level === 'safe' ? 'clean' : 'suspicious', txt: level === 'safe' ? 'CLEAN' : 'UNKNOWN' });
  }
  /* Deduplicate by txt */
  return [...new Map(tags.map(t => [t.txt, t])).values()];
}

/* ═══════════════════════════════════════════════════════
   HISTORY  (sessionStorage for persistence within tab)
═══════════════════════════════════════════════════════ */
function addHistory(url, level, score) {
  scanHistory.unshift({ url, level, score });
  if (scanHistory.length > 6) scanHistory = scanHistory.slice(0, 6);
  try { sessionStorage.setItem('lr_history', JSON.stringify(scanHistory)); } catch {}
  renderHistory();
}

function loadHistory() {
  try {
    const saved = sessionStorage.getItem('lr_history');
    if (saved) scanHistory = JSON.parse(saved);
  } catch {}
}

function renderHistory() {
  const sec  = document.getElementById('histSec');
  const list = document.getElementById('histList');
  if (!scanHistory.length) { sec.style.display = 'none'; return; }
  sec.style.display = 'block';
  list.innerHTML = scanHistory.map((h, i) => `
    <div class="hi" onclick="reScan(${i})">
      <div class="hd ${h.level}"></div>
      <span class="hu">${escH(h.url)}</span>
      <span class="hs">${h.score}/100</span>
    </div>`).join('');
}

function reScan(i) {
  const h = scanHistory[i];
  if (!h) return;
  document.getElementById('urlInput').value = h.url;
  startScan();
}

/* ═══════════════════════════════════════════════════════
   SHARE
═══════════════════════════════════════════════════════ */
function doShare() {
  if (!lastResult) return;
  const L   = TRANSLATIONS[window.currentLang];
  const txt = L.shareMsg(lastResult.domain, lastResult.score, lastResult.level);

  if (navigator.share) {
    navigator.share({ title: 'LinkReaper', text: txt, url: 'https://linkreaper.app' }).catch(() => {});
  } else {
    navigator.clipboard.writeText(txt)
      .then(() => {
        const btn  = document.getElementById('shareBtn');
        const orig = btn.innerHTML;
        btn.innerHTML = '✅ <span>Copied!</span>';
        setTimeout(() => { btn.innerHTML = orig; }, 2200);
      })
      .catch(() => {
        /* final fallback */
        prompt('Copy this:', txt);
      });
  }
}

/* ═══════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════ */
function escH(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  loadHistory();
  setLang('ar');

  /* Enter key */
  document.getElementById('urlInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !isScanning) startScan();
  });

  /* Paste event — auto-scan after paste if URL looks valid */
  document.getElementById('urlInput').addEventListener('paste', () => {
    setTimeout(() => {
      const val = document.getElementById('urlInput').value.trim();
      if (val.startsWith('http') || val.includes('.')) startScan();
    }, 100);
  });
});
