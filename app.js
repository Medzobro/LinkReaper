'use strict';
/* =====================================================
   LinkReaper v6 — app.js
   Engine + UI controller
   API names hidden from users — only results shown
   ===================================================== */

/* ── API keys (internal only) ── */
const _K = {
  G: 'AIzaSyBeucRtC0zMiMl1emlFUVV7lBTJNSFPcxk',
  U: '019da299-b76e-7693-ac72-23511c56372e',
  A: '22c0cce3773d8dbd84af79a5ded571bbc1e278ee70bac2a5ea3a44469e9f17788a2b9ccc39a25ead',
};

/* ── Constants ── */
const RING_C = 213.628; // 2 * PI * 34
const COLORS  = { safe: '#00FF88', warning: '#FFB300', danger: '#FF2244' };
const TRUSTED = new Set([
  'google.com','youtube.com','twitter.com','x.com','facebook.com','instagram.com',
  'github.com','microsoft.com','apple.com','amazon.com','wikipedia.org','whatsapp.com',
  'linkedin.com','tiktok.com','snapchat.com','netflix.com','paypal.com','adobe.com',
  'dropbox.com','zoom.us','spotify.com','reddit.com','twitch.tv','discord.com',
  'telegram.org','t.me','office.com','live.com','outlook.com',
  'yahoo.com','bing.com','duckduckgo.com','cloudflare.com',
]);
const BAD_TLDS = [
  '.xyz','.tk','.ml','.ga','.cf','.gq','.top','.click','.loan','.win',
  '.download','.stream','.party','.bid','.review','.accountant',
  '.science','.faith','.date','.racing','.trade','.webcam',
];
const PHISH_W = [
  'login','verify','secure','account','update','confirm','paypal','apple-id',
  'microsoft','amazon','bank','password','signin','wallet','crypto','free',
  'prize','winner','urgent','suspended','alert','activation','webscr',
  'cmd=','recover','ebayisapi','authenticate','validate','password-reset',
];

/* ── State ── */
let lang       = 'ar';
let lastResult = null;
let history    = [];
let scanning   = false;
let _tTimer    = null;

/* ── Helpers ── */
const $   = id => document.getElementById(id);
const esc = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseURL(raw) {
  try {
    let u = raw.trim();
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    const p = new URL(u);
    return { ok:true, domain:p.hostname.toLowerCase(), protocol:p.protocol, href:u };
  } catch { return { ok:false, domain:'', protocol:'', href:'' }; }
}

function isTrusted(domain) {
  if (TRUSTED.has(domain)) return true;
  for (const t of TRUSTED) { if (domain.endsWith('.'+t)) return true; }
  return false;
}

/* ── Typing effect ── */
function typeText(el, txt, spd = 24) {
  return new Promise(res => {
    if (_tTimer) { clearInterval(_tTimer); _tTimer = null; }
    el.innerHTML = '<span class="tc"></span>';
    let i = 0;
    _tTimer = setInterval(() => {
      i++;
      if (i <= txt.length) {
        el.textContent = txt.slice(0, i);
        el.insertAdjacentHTML('beforeend', '<span class="tc"></span>');
      } else {
        clearInterval(_tTimer); _tTimer = null;
        el.textContent = txt;
        el.insertAdjacentHTML('beforeend', '<span class="tc"></span>');
        res();
      }
    }, spd);
  });
}

/* ── Score ring ── */
function animateRing(score, level) {
  const fill  = $('ringFill');
  const numEl = $('ringNum');
  const col   = COLORS[level] || COLORS.danger;
  fill.style.stroke = col;
  numEl.style.color = col;
  fill.style.transition = 'none';
  fill.style.strokeDashoffset = RING_C;
  // Double rAF to guarantee browser flush before animating
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.34,1.2,.64,1)';
    fill.style.strokeDashoffset = RING_C - (RING_C * score / 100);
  }));
  const t0 = performance.now();
  (function step(now) {
    const p = Math.min((now - t0) / 1000, 1);
    numEl.textContent = Math.round(score * (1 - Math.pow(1-p, 3)));
    if (p < 1) requestAnimationFrame(step);
  })(performance.now());
}

function setRingStatic(score, level) {
  const fill  = $('ringFill');
  const numEl = $('ringNum');
  const col   = COLORS[level] || COLORS.danger;
  fill.style.transition = 'none';
  fill.style.stroke = col;
  numEl.style.color = col;
  numEl.textContent = score;
  requestAnimationFrame(() => {
    fill.style.strokeDashoffset = RING_C - (RING_C * score / 100);
  });
}

/* ── Fetch with timeout ── */
function fetchT(url, opts = {}, ms = 9000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

/* ── Scan Progress UI ── */
// step states: wait | run | ok | warn | bad | skip
function setStep(i, state, extraTxt = '') {
  const L    = T[lang];
  const step = $('sp-step-' + i);
  const sts  = $('sp-sts-'  + i);
  if (!step || !sts) return;

  // CSS classes
  step.classList.remove('active','done');
  if (state === 'run')  step.classList.add('active');
  if (['ok','warn','bad','skip'].includes(state)) step.classList.add('done');

  // Badge
  const MAP = {
    wait: ['ss-wait', '—'],
    run:  ['ss-run',  '…'],
    ok:   ['ss-ok',   L.done],
    warn: ['ss-warn', '⚠️'],
    bad:  ['ss-bad',  '🚨'],
    skip: ['ss-skip', L.skip],
  };
  const [cls, txt] = MAP[state] || MAP.wait;
  sts.className    = 'sp-step-status ' + cls;
  sts.textContent  = extraTxt || txt;
}

function setProgress(pct) {
  $('progFill').style.width = pct + '%';
  $('sp-pct').textContent   = Math.round(pct) + '%';
}

/* =====================================================
   HEURISTIC ENGINE
   ===================================================== */
function runHeuristics(rawUrl) {
  const C = T[lang].ck;
  const { ok, domain, protocol } = parseURL(rawUrl);
  let score = 100;
  const checks = [];

  if (!ok) return { score:0, checks:[{ cls:'chk-bad', txt:C.ipBad }], domain:'???' };

  /* 1. HTTPS */
  if (protocol === 'https:') { checks.push({ cls:'chk-ok',  txt:C.httpsOk }); }
  else                       { checks.push({ cls:'chk-bad', txt:C.httpsBad }); score -= 28; }

  /* 2. Direct IP */
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(domain)) {
    checks.push({ cls:'chk-bad', txt:C.ipBad }); score -= 38;
  } else { checks.push({ cls:'chk-ok', txt:C.ipOk }); }

  /* 3. Trusted domain */
  const trusted = isTrusted(domain);
  if (trusted) { checks.push({ cls:'chk-ok', txt:C.trusted }); score = Math.min(score+18, 100); }

  /* 4. Bad TLD */
  if (!trusted && BAD_TLDS.some(t => domain.endsWith(t))) {
    checks.push({ cls:'chk-bad', txt:C.tldBad }); score -= 22;
  } else if (!trusted) { checks.push({ cls:'chk-ok', txt:C.tldOk }); }

  /* 5. Phishing keywords */
  const found = PHISH_W.filter(w => rawUrl.toLowerCase().includes(w));
  if      (found.length >= 3) { checks.push({ cls:'chk-bad',  txt:C.phishM(found.length, found.slice(0,3).join(', ')) }); score -= 28; }
  else if (found.length >= 1) { checks.push({ cls:'chk-warn', txt:C.phishO(found[0]) }); score -= 8; }
  else                        { checks.push({ cls:'chk-ok',   txt:C.phishOk }); }

  /* 6. URL length */
  const len = rawUrl.length;
  if      (len > 150) { checks.push({ cls:'chk-bad',  txt:C.longB(len) }); score -= 13; }
  else if (len >  80) { checks.push({ cls:'chk-warn', txt:C.longW(len) }); score -=  3; }
  else                { checks.push({ cls:'chk-ok',   txt:C.longOk(len) }); }

  /* 7. Subdomains */
  const parts = domain.split('.');
  if      (parts.length > 5) { checks.push({ cls:'chk-bad',  txt:C.subB(parts.length-2) }); score -= 18; }
  else if (parts.length > 3) { checks.push({ cls:'chk-warn', txt:C.subW }); score -= 5; }
  else                       { checks.push({ cls:'chk-ok',   txt:C.subOk }); }

  /* 8. Special chars */
  if (/[^a-z0-9.-]/.test(domain)) { checks.push({ cls:'chk-bad', txt:C.specialBad }); score -= 22; }
  else if (!checks.some(c => c.cls === 'chk-bad' && c.txt === C.ipBad)) {
    checks.push({ cls:'chk-ok', txt:C.cleanDomain });
  }

  return { score:Math.max(0, Math.min(100, score)), checks, domain };
}

/* =====================================================
   SECURITY CHECKS (internal, no API names to user)
   ===================================================== */

/* Check 1: Google Safe Browsing */
async function _checkSafety(rawUrl) {
  try {
    const res = await fetchT(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${_K.G}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { clientId:'linkreaper', clientVersion:'6.0' },
          threatInfo: {
            threatTypes: ['MALWARE','SOCIAL_ENGINEERING','UNWANTED_SOFTWARE','POTENTIALLY_HARMFUL_APPLICATION'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url: rawUrl }],
          },
        }),
      },
      10000
    );
    if (!res.ok) return { status:'err', score:0, check:null };
    const data = await res.json();
    if (data.matches && data.matches.length > 0) {
      const types = [...new Set(data.matches.map(m => m.threatType))];
      // Map internal threat types to user-friendly check keys
      const isPhish   = types.some(t => t === 'SOCIAL_ENGINEERING');
      const isMalware = types.some(t => t === 'MALWARE' || t === 'UNWANTED_SOFTWARE');
      const checkKey  = isPhish ? 'knownPhishing' : 'knownMalware';
      return { status:'bad', score:-45, check:checkKey };
    }
    return { status:'ok', score:0, check:'cleanDomain' };
  } catch(e) {
    return { status:e.name==='AbortError'?'skip':'skip', score:0, check:null };
  }
}

/* Check 2: URLScan deep scan */
async function _checkContent(rawUrl) {
  try {
    const sub = await fetchT(
      'https://urlscan.io/api/v1/scan/',
      {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'API-Key':_K.U },
        body: JSON.stringify({ url:rawUrl, visibility:'unlisted' }),
      },
      12000
    );
    if (sub.status === 429) return { status:'skip', score:0, check:null };
    if (!sub.ok)            return { status:'skip', score:0, check:null };
    const { uuid } = await sub.json();
    if (!uuid) return { status:'skip', score:0, check:null };

    // Poll up to 25 seconds
    for (let i = 0; i < 10; i++) {
      await sleep(2500);
      try {
        const poll = await fetchT(`https://urlscan.io/api/v1/result/${uuid}/`, {}, 5000);
        if (poll.status === 404) continue;
        if (!poll.ok) continue;
        const r = await poll.json();
        const v = r.verdicts?.overall;
        if (v?.malicious) return { status:'bad',  score:-40, check:'knownMalware' };
        if ((v?.score||0) > 50) return { status:'warn', score:-15, check:null };
        return { status:'ok', score:0, check:null };
      } catch { continue; }
    }
    return { status:'skip', score:0, check:null };
  } catch(e) {
    // CORS from local — silently skip
    return { status:'skip', score:0, check:null };
  }
}

/* Check 3: IP reputation via DNS then AbuseIPDB */
async function _checkNetwork(domain) {
  try {
    // Resolve IP (Cloudflare DoH — browser safe)
    const dns = await fetchT(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      { headers:{ 'Accept':'application/dns-json' } },
      5000
    );
    if (!dns.ok) return { status:'skip', score:0, check:null, ip:null };
    const dnsData = await dns.json();
    const ip = (dnsData.Answer||[]).find(a => a.type===1)?.data;
    if (!ip) return { status:'skip', score:0, check:null, ip:null };

    // Check IP reputation
    const res = await fetchT(
      `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`,
      { headers:{ 'Key':_K.A, 'Accept':'application/json' } },
      7000
    );
    if (!res.ok) return { status:'skip', score:0, check:null, ip };
    const d   = await res.json();
    const pct = d.data?.abuseConfidenceScore ?? 0;
    const rpt = d.data?.totalReports ?? 0;

    if (pct >= 50) return { status:'bad',  score:-35, check:'ipAbuse', checkArg:pct, ip };
    if (pct >= 15 || rpt > 5) return { status:'warn', score:-12, check:'ipAbuse', checkArg:pct, ip };
    return { status:'ok', score:0, check:'ipClean', checkArg:ip, ip };
  } catch(e) {
    return { status:'skip', score:0, check:null, ip:null };
  }
}

/* Check 4: Phishing database lookup */
async function _checkDatabase(rawUrl) {
  const { domain } = parseURL(rawUrl);
  if (!domain) return { status:'skip', score:0, check:null };
  try {
    const res = await fetchT(
      `https://api.phishstats.info/api/phishing?_where=(url,like,~${encodeURIComponent(domain)}~)&_size=5&_sort=-id`,
      { headers:{ 'Accept':'application/json' } },
      7000
    );
    if (res.status === 404) return { status:'ok',   score:0,   check:null };
    if (res.status === 429) return { status:'skip', score:0,   check:null };
    if (!res.ok)            return { status:'skip', score:0,   check:null };
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0)
      return { status:'bad', score:-30, check:'knownPhishing' };
    return { status:'ok', score:0, check:null };
  } catch(e) {
    return { status:'skip', score:0, check:null };
  }
}

/* =====================================================
   AGGREGATE SCORE
   ===================================================== */
function aggregate(hScore, checks) {
  let s = hScore;
  checks.forEach(c => { if (typeof c.score === 'number') s += c.score; });
  return Math.max(0, Math.min(100, s));
}
function toLevel(s) { return s >= 70 ? 'safe' : s >= 40 ? 'warning' : 'danger'; }

/* =====================================================
   BUILD THREAT TAGS (no API names)
   ===================================================== */
function buildTags(secChecks, level) {
  const tags = [];
  secChecks.forEach(c => {
    if (c.status === 'bad') {
      if (c.check === 'knownMalware')  tags.push({ cls:'malware',  txt:'MALWARE' });
      if (c.check === 'knownPhishing') tags.push({ cls:'phishing', txt:'PHISHING' });
      if (c.check === 'ipAbuse')       tags.push({ cls:'abuse',    txt:'IP ABUSE' });
    }
    if (c.status === 'warn') tags.push({ cls:'suspicious', txt:'SUSPICIOUS' });
  });
  if (!tags.length)
    tags.push({ cls: level==='safe'?'clean':'suspicious', txt: level==='safe'?'CLEAN':'UNKNOWN' });
  return [...new Map(tags.map(t=>[t.txt,t])).values()];
}

/* =====================================================
   MAIN SCAN
   ===================================================== */
async function startScan() {
  if (scanning) return;
  const L   = T[lang];
  const raw = $('urlInput').value.trim();

  if (!raw) {
    const inp = $('urlInput');
    inp.style.borderColor = 'var(--neon)';
    inp.style.boxShadow   = 'var(--s-red)';
    typeText($('monTxt'), L.empty);
    setTimeout(() => { inp.style.borderColor=''; inp.style.boxShadow=''; }, 900);
    return;
  }

  const parsed = parseURL(raw);
  if (!parsed.ok) { typeText($('monTxt'), L.empty); return; }

  scanning = true;
  $('scanBtn').disabled   = true;
  $('resCard').style.display   = 'none';
  $('tipsCard').style.display  = 'none';

  // Show progress card
  const sp = $('scanProgress');
  sp.style.display = 'block';
  for (let i = 0; i < 5; i++) setStep(i, 'wait');
  setProgress(0);
  $('sp-title').textContent = L.scanTitle;

  $('monAv').textContent = '🔍';
  typeText($('monTxt'), L.checking, 18);

  const secChecks = [];

  try {
    /* Step 0 — Heuristics */
    setStep(0, 'run');
    typeText($('monTxt'), L.steps[0] + '…', 18);
    const hRes = runHeuristics(raw);
    await sleep(300);
    setStep(0, hRes.score >= 72 ? 'ok' : hRes.score >= 42 ? 'warn' : 'bad');
    setProgress(20);

    /* Step 1 — Safety check */
    setStep(1, 'run');
    typeText($('monTxt'), L.steps[1] + '…', 18);
    const s1 = await _checkSafety(raw);
    secChecks.push(s1);
    setStep(1, s1.status);
    setProgress(40);

    /* Step 2 — Content analysis */
    setStep(2, 'run');
    typeText($('monTxt'), L.steps[2] + '…', 18);
    const s2 = await _checkContent(raw);
    secChecks.push(s2);
    setStep(2, s2.status);
    setProgress(60);

    /* Step 3 — Network analysis */
    setStep(3, 'run');
    typeText($('monTxt'), L.steps[3] + '…', 18);
    const s3 = await _checkNetwork(parsed.domain);
    secChecks.push(s3);
    setStep(3, s3.status);
    setProgress(80);

    /* Step 4 — Database check */
    setStep(4, 'run');
    typeText($('monTxt'), L.steps[4] + '…', 18);
    const s4 = await _checkDatabase(raw);
    secChecks.push(s4);
    setStep(4, s4.status);
    setProgress(100);

    await sleep(200);
    sp.style.display = 'none';

    // Compute final score
    const finalScore = aggregate(hRes.score, secChecks);
    const level      = toLevel(finalScore);

    // Add security-check-derived checks to heuristic checks
    const C = T[lang].ck;
    secChecks.forEach(c => {
      if (!c.check) return;
      const fn = C[c.check];
      if (!fn) return;
      const txt = typeof fn === 'function'
        ? fn(c.checkArg || c.ip || '')
        : fn;
      const cls = c.status === 'ok' ? 'chk-ok' : c.status === 'warn' ? 'chk-warn' : 'chk-bad';
      hRes.checks.push({ cls, txt });
    });

    lastResult = { score:finalScore, level, secChecks, hChecks:hRes.checks, domain:parsed.domain, rawUrl:raw };
    renderResult(lastResult, true);
    addHistory(raw, level, finalScore);

  } catch(err) {
    console.error('Scan error:', err);
    sp.style.display = 'none';
    typeText($('monTxt'), '⚠️ حدث خطأ. حاول مجدداً.');
  } finally {
    scanning = false;
    $('scanBtn').disabled = false;
  }
}

/* =====================================================
   RENDER RESULT
   ===================================================== */
function renderResult({ score, level, secChecks, hChecks, domain, rawUrl }, animate) {
  const L    = T[lang];
  const card = $('resCard');
  card.className    = level;
  card.style.display = 'block';

  animate ? animateRing(score, level) : setRingStatic(score, level);

  $('resVerdict').textContent = L.verdict[level];
  $('resDomain').textContent  = domain || rawUrl;

  // Threat tags
  const tags = buildTags(secChecks, level);
  $('threatTags').innerHTML = tags.map(t => `<div class="ttag ${t.cls}">${esc(t.txt)}</div>`).join('');

  // AI verdict
  const arr = L.ai[level];
  $('aiVerdict').textContent = arr[Math.floor(Math.random() * arr.length)](domain||rawUrl, score);

  // Check items (heuristic + security — no API names)
  $('chkGrid').innerHTML = hChecks.map(c => `
    <div class="ci ${c.cls}">
      <span>${c.cls==='chk-ok'?'✅':c.cls==='chk-warn'?'⚠️':'❌'}</span>
      <span>${esc(c.txt)}</span>
    </div>`).join('');

  // Tips
  if (level === 'danger') {
    const [title, ...rest] = L.tips.split(':');
    $('tipsCard').innerHTML      = `<strong>${esc(title)}:</strong>${esc(rest.join(':'))}`;
    $('tipsCard').style.display  = 'block';
  } else {
    $('tipsCard').style.display = 'none';
  }

  // Monster
  $('monAv').textContent = level==='safe'?'😌':level==='warning'?'😒':'😱';
  typeText($('monTxt'), L.monR[level], 22);

  if (animate) card.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

/* =====================================================
   LANGUAGE
   ===================================================== */
function setLang(l) {
  lang = l;
  const L    = T[l];
  const html = document.documentElement;
  html.setAttribute('lang', l);
  html.setAttribute('dir',  L.dir);

  document.querySelectorAll('.lbtn').forEach(b =>
    b.classList.toggle('on', b.getAttribute('onclick').includes(`'${l}'`))
  );

  const s = (id, v) => { const e=$(id); if(e) e.textContent=v; };
  s('tagline',      L.tagline);
  s('inputLabel',   L.lbl);
  s('sp-title',     L.scanTitle);
  s('chkTitle',     L.chkH);
  s('histLbl',      L.histH);
  s('bannerTitle',  L.banT);
  s('bannerDesc',   L.banD);
  s('xTxt',         L.xTxt);
  s('tgTxt',        L.tgTxt);
  s('shareTxt',     L.share);
  s('disclaimerEl', L.disc);
  s('scanBtnTxt',   L.btn);

  const inp = $('urlInput'); if(inp) inp.placeholder = L.ph;
  $('footerEl').innerHTML = `${L.foot} &nbsp;•&nbsp; <span>${L.footSub}</span>`;

  // Update step labels
  L.steps.forEach((txt, i) => {
    const lbl = $('sp-lbl-'+i); if(lbl) lbl.textContent = txt;
    const sts = $('sp-sts-'+i); if(sts) { sts.className='sp-step-status ss-wait'; sts.textContent='—'; }
  });

  $('monAv').textContent = '💀';
  typeText($('monTxt'), L.idle);

  // Update tips if visible
  const tc = $('tipsCard');
  if (tc && tc.style.display !== 'none') {
    const [title,...rest] = L.tips.split(':');
    tc.innerHTML = `<strong>${esc(title)}:</strong>${esc(rest.join(':'))}`;
  }

  if (lastResult) renderResult(lastResult, false);
  renderHistory();
}

/* =====================================================
   HISTORY
   ===================================================== */
function addHistory(url, level, score) {
  history.unshift({ url, level, score });
  if (history.length > 6) history = history.slice(0, 6);
  try { sessionStorage.setItem('lr_h', JSON.stringify(history)); } catch {}
  renderHistory();
}
function loadHistory() {
  try { const s=sessionStorage.getItem('lr_h'); if(s) history=JSON.parse(s); } catch {}
}
function renderHistory() {
  const sec=  $('histSec');
  const list= $('histList');
  if (!history.length) { sec.style.display='none'; return; }
  sec.style.display = 'block';
  list.innerHTML = history.map((h,i) => `
    <div class="hi" onclick="reScan(${i})">
      <div class="hd ${h.level}"></div>
      <span class="hu">${esc(h.url)}</span>
      <span class="hs">${h.score}/100</span>
    </div>`).join('');
}
function reScan(i) {
  const h = history[i]; if(!h) return;
  $('urlInput').value = h.url; startScan();
}

/* =====================================================
   SHARE
   ===================================================== */
function doShare() {
  if (!lastResult) return;
  const txt = T[lang].shareMsg(lastResult.domain, lastResult.score, lastResult.level);
  if (navigator.share) {
    navigator.share({ title:'LinkReaper', text:txt, url:'https://linkreaper.app' }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(txt)
      .then(() => {
        const btn=  $('shareBtn'), orig=btn.innerHTML;
        btn.innerHTML = '✅ <span>Copied!</span>';
        setTimeout(() => { btn.innerHTML=orig; }, 2200);
      })
      .catch(() => prompt('Copy:', txt));
  }
}

/* =====================================================
   INIT
   ===================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // Particles
  const pc = $('pts');
  if (!window.matchMedia('(prefers-reduced-motion:reduce)').matches) {
    for (let i=0; i<20; i++) {
      const p = document.createElement('div');
      p.className = 'pt';
      p.style.cssText = [
        `right:${Math.random()*100}%`,
        `animation-duration:${8+Math.random()*12}s`,
        `animation-delay:${Math.random()*10}s`,
        `width:${1+Math.random()*2}px`,
        `height:${1+Math.random()*2}px`,
      ].join(';');
      pc.appendChild(p);
    }
  }

  loadHistory();
  setLang('ar');

  $('urlInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !scanning) startScan();
  });

  $('urlInput').addEventListener('paste', () => {
    setTimeout(() => {
      const v = $('urlInput').value.trim();
      if ((v.startsWith('http') || v.includes('.')) && !scanning) startScan();
    }, 80);
  });
});
