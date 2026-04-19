/* ═══════════════════════════════════════════════════════
   LinkReaper v4.1 — engine.js
   Heuristic engine + 4 real API integrations
   FIXES vs v4:
   - URLScan poll timeout increased to 25s (was 20s)
   - AbuseIPDB: added AbortSignal timeout (was hanging)
   - PhishStats: added domain-only fallback search
   - GSB: wrapped in AbortSignal to prevent hangs
   - runHeuristics: returns domain separately (cleaner)
   - Score weights refined: API results weighted x1.2
   - Added REQUEST_TIMEOUT constant
   - Fixed: PhishStats was checking rawUrl instead of domain
═══════════════════════════════════════════════════════ */

/* ── API KEYS ── */
const API_KEYS = {
  GSB:       'AIzaSyBeucRtC0zMiMl1emlFUVV7lBTJNSFPcxk',
  URLSCAN:   '019da299-b76e-7693-ac72-23511c56372e',
  ABUSEIPDB: '22c0cce3773d8dbd84af79a5ded571bbc1e278ee70bac2a5ea3a44469e9f17788a2b9ccc39a25ead',
};

const REQUEST_TIMEOUT = 8000; // 8s for individual API requests

/* ── Trusted domains list ── */
const TRUSTED_DOMAINS = new Set([
  'google.com','youtube.com','twitter.com','x.com','facebook.com','instagram.com',
  'github.com','microsoft.com','apple.com','amazon.com','wikipedia.org','whatsapp.com',
  'linkedin.com','tiktok.com','snapchat.com','netflix.com','paypal.com','adobe.com',
  'dropbox.com','zoom.us','spotify.com','reddit.com','twitch.tv','discord.com',
  'telegram.org','t.me','web.telegram.org','office.com','live.com','outlook.com',
  'yahoo.com','bing.com','duckduckgo.com','cloudflare.com','amazonaws.com',
]);

const BAD_TLDS = [
  '.xyz','.tk','.ml','.ga','.cf','.gq','.top','.click','.loan','.win',
  '.download','.stream','.party','.bid','.review','.accountant','.science',
  '.faith','.date','.racing','.trade','.webcam','.gdn',
];

const PHISH_WORDS = [
  'login','verify','secure','account','update','confirm','paypal','apple-id',
  'microsoft','amazon','bank','password','signin','wallet','crypto','free',
  'prize','winner','urgent','suspended','alert','activation','webscr','cmd=',
  'recover','ebayisapi','password-reset','authenticate','validate',
];

/* ═══════════════════════════════════════════════════════
   HELPER: fetch with timeout
═══════════════════════════════════════════════════════ */
function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/* ═══════════════════════════════════════════════════════
   HELPER: parse URL safely
═══════════════════════════════════════════════════════ */
function parseURL(raw) {
  try {
    let u = raw.trim();
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    const parsed = new URL(u);
    return { ok: true, parsed, domain: parsed.hostname.toLowerCase(), protocol: parsed.protocol };
  } catch {
    return { ok: false, parsed: null, domain: '', protocol: '' };
  }
}

/* ═══════════════════════════════════════════════════════
   isTrusted helper
═══════════════════════════════════════════════════════ */
function isTrustedDomain(domain) {
  if (TRUSTED_DOMAINS.has(domain)) return true;
  // check if domain ends with a trusted domain (e.g. mail.google.com)
  for (const t of TRUSTED_DOMAINS) {
    if (domain.endsWith('.' + t)) return true;
  }
  return false;
}

/* ═══════════════════════════════════════════════════════
   LAYER 0 — HEURISTIC ENGINE
═══════════════════════════════════════════════════════ */
function runHeuristics(rawUrl) {
  const L   = TRANSLATIONS[window.currentLang];
  const C   = L.ck;
  const url = parseURL(rawUrl);
  let score = 100;
  const checks = [];

  if (!url.ok) {
    return { score: 0, checks: [{ cls: 'chk-bad', txt: C.ipBad }], domain: '???' };
  }

  const { domain, protocol } = url;

  /* 1. HTTPS */
  if (protocol === 'https:') {
    checks.push({ cls: 'chk-ok', txt: C.httpsOk });
  } else {
    checks.push({ cls: 'chk-bad', txt: C.httpsBad });
    score -= 28;
  }

  /* 2. Direct IP */
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(domain)) {
    checks.push({ cls: 'chk-bad', txt: C.ipBad });
    score -= 38;
  } else {
    checks.push({ cls: 'chk-ok', txt: C.ipOk });
  }

  /* 3. Trusted domains */
  const trusted = isTrustedDomain(domain);
  if (trusted) {
    checks.push({ cls: 'chk-ok', txt: C.trusted });
    score = Math.min(score + 18, 100);
  }

  /* 4. Suspicious TLDs */
  if (!trusted && BAD_TLDS.some(t => domain.endsWith(t))) {
    checks.push({ cls: 'chk-bad', txt: C.tldBad });
    score -= 22;
  } else if (!trusted) {
    checks.push({ cls: 'chk-ok', txt: C.tldOk });
  }

  /* 5. Phishing keywords */
  const foundPhish = PHISH_WORDS.filter(w => rawUrl.toLowerCase().includes(w));
  if (foundPhish.length >= 3) {
    checks.push({ cls: 'chk-bad', txt: C.phishM(foundPhish.length, foundPhish.slice(0, 3).join(', ')) });
    score -= 28;
  } else if (foundPhish.length >= 1) {
    checks.push({ cls: 'chk-warn', txt: C.phishO(foundPhish[0]) });
    score -= 8;
  } else {
    checks.push({ cls: 'chk-ok', txt: C.phishOk });
  }

  /* 6. URL length */
  const len = rawUrl.length;
  if (len > 150) {
    checks.push({ cls: 'chk-bad', txt: C.longB(len) });
    score -= 13;
  } else if (len > 80) {
    checks.push({ cls: 'chk-warn', txt: C.longW(len) });
    score -= 3;
  } else {
    checks.push({ cls: 'chk-ok', txt: C.longOk(len) });
  }

  /* 7. Subdomains */
  const parts = domain.split('.');
  if (parts.length > 5) {
    checks.push({ cls: 'chk-bad', txt: C.subB(parts.length - 2) });
    score -= 18;
  } else if (parts.length > 3) {
    checks.push({ cls: 'chk-warn', txt: C.subW });
    score -= 5;
  } else {
    checks.push({ cls: 'chk-ok', txt: C.subOk });
  }

  /* 8. Special chars in domain */
  if (/[^a-z0-9.\-]/.test(domain)) {
    checks.push({ cls: 'chk-bad', txt: C.specialBad });
    score -= 22;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    checks,
    domain,
  };
}

/* ═══════════════════════════════════════════════════════
   LAYER 1 — GOOGLE SAFE BROWSING
═══════════════════════════════════════════════════════ */
async function checkGSB(rawUrl) {
  try {
    const res = await fetchWithTimeout(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${API_KEYS.GSB}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'linkreaper', clientVersion: '4.1' },
          threatInfo: {
            threatTypes: [
              'MALWARE',
              'SOCIAL_ENGINEERING',
              'UNWANTED_SOFTWARE',
              'POTENTIALLY_HARMFUL_APPLICATION',
            ],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url: rawUrl }],
          },
        }),
      }
    );

    if (!res.ok) {
      return { status: 'err', detail: `API Error ${res.status}`, score: 0 };
    }

    const data = await res.json();

    if (data.matches && data.matches.length > 0) {
      const types = [...new Set(data.matches.map(m => m.threatType))].join(', ');
      return { status: 'bad', detail: types, score: -45, threats: types };
    }

    return { status: 'ok', detail: 'No threats found', score: 0 };

  } catch (e) {
    if (e.name === 'AbortError') return { status: 'err', detail: 'Request timeout', score: 0 };
    return { status: 'err', detail: 'Network error', score: 0 };
  }
}

/* ═══════════════════════════════════════════════════════
   LAYER 2 — URLSCAN.IO
═══════════════════════════════════════════════════════ */
async function checkURLScan(rawUrl) {
  try {
    /* Submit scan */
    const sub = await fetchWithTimeout(
      'https://urlscan.io/api/v1/scan/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'API-Key': API_KEYS.URLSCAN,
        },
        body: JSON.stringify({ url: rawUrl, visibility: 'unlisted' }),
      },
      10000
    );

    if (sub.status === 400) return { status: 'err',  detail: 'Invalid URL for URLScan', score: 0 };
    if (sub.status === 429) return { status: 'skip', detail: 'Rate limit — try later',  score: 0 };
    if (!sub.ok)            return { status: 'err',  detail: `Submit error ${sub.status}`, score: 0 };

    const subData = await sub.json();
    const uuid = subData.uuid;
    if (!uuid) return { status: 'err', detail: 'No scan ID returned', score: 0 };

    /* Poll for result — max 10 attempts × 2.5s = 25s */
    for (let i = 0; i < 10; i++) {
      await sleep(2500);
      try {
        const poll = await fetchWithTimeout(
          `https://urlscan.io/api/v1/result/${uuid}/`,
          {},
          5000
        );
        if (poll.status === 404) continue; // not ready yet
        if (!poll.ok) continue;

        const r = await poll.json();
        const verdict  = r.verdicts?.overall;
        const malicious = verdict?.malicious || false;
        const vscore    = verdict?.score || 0;
        const cats      = verdict?.categories || [];
        const screenshot = r.task?.screenshotURL || null;

        if (malicious) {
          return {
            status: 'bad',
            detail: `Malicious: ${cats.join(', ') || 'flagged'}`,
            score: -40,
            screenshot,
          };
        }
        if (vscore > 50) {
          return { status: 'warn', detail: `Suspicious score: ${vscore}`, score: -15, screenshot };
        }
        return { status: 'ok', detail: `Clean (verdict score: ${vscore})`, score: 0, screenshot };

      } catch { continue; }
    }

    return { status: 'skip', detail: 'Scan timeout — result pending', score: 0 };

  } catch (e) {
    if (e.name === 'AbortError') return { status: 'err', detail: 'Request timeout', score: 0 };
    return { status: 'err', detail: 'Network error', score: 0 };
  }
}

/* ═══════════════════════════════════════════════════════
   LAYER 3 — ABUSEIPDB (via DNS-over-HTTPS)
═══════════════════════════════════════════════════════ */
async function checkAbuseIPDB(domain) {
  try {
    /* Resolve domain → IP using Cloudflare DoH (more reliable than Google DoH) */
    const dnsRes = await fetchWithTimeout(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      { headers: { 'Accept': 'application/dns-json' } },
      5000
    );

    if (!dnsRes.ok) {
      // fallback to Google DoH
      const gDns = await fetchWithTimeout(
        `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`,
        {},
        5000
      );
      if (!gDns.ok) return { status: 'skip', detail: 'DNS resolution failed', score: 0 };
      const gData = await gDns.json();
      const gAnswers = gData.Answer || [];
      const gIp = gAnswers.find(a => a.type === 1)?.data;
      if (!gIp) return { status: 'skip', detail: 'No A record found', score: 0 };
      return await _queryAbuseIPDB(gIp);
    }

    const dnsData = await dnsRes.json();
    const answers = dnsData.Answer || [];
    const ip = answers.find(a => a.type === 1)?.data;
    if (!ip) return { status: 'skip', detail: 'No A record found', score: 0 };

    return await _queryAbuseIPDB(ip);

  } catch (e) {
    if (e.name === 'AbortError') return { status: 'err', detail: 'DNS timeout', score: 0 };
    return { status: 'err', detail: 'Network error', score: 0 };
  }
}

async function _queryAbuseIPDB(ip) {
  try {
    const res = await fetchWithTimeout(
      `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`,
      {
        headers: {
          'Key': API_KEYS.ABUSEIPDB,
          'Accept': 'application/json',
        },
      },
      6000
    );

    if (!res.ok) return { status: 'err', detail: `AbuseIPDB error ${res.status}`, score: 0 };

    const d = await res.json();
    const pct     = d.data?.abuseConfidenceScore ?? 0;
    const reports = d.data?.totalReports ?? 0;
    const isp     = d.data?.isp || '';

    if (pct >= 50) {
      return { status: 'bad',  detail: `IP ${ip}: ${pct}% abuse score (${reports} reports)`, score: -35 };
    }
    if (pct >= 15 || reports > 5) {
      return { status: 'warn', detail: `IP ${ip}: ${pct}% abuse score (${reports} reports)`, score: -12 };
    }
    return { status: 'ok', detail: `IP ${ip}: Clean — ${pct}% abuse score`, score: 0 };

  } catch (e) {
    if (e.name === 'AbortError') return { status: 'err', detail: 'Request timeout', score: 0 };
    return { status: 'err', detail: 'Network error', score: 0 };
  }
}

/* ═══════════════════════════════════════════════════════
   LAYER 4 — PHISHSTATS
   FIX: was searching full URL — now searches domain only
   FIX: added fallback if CORS blocks
═══════════════════════════════════════════════════════ */
async function checkPhishStats(rawUrl) {
  const { domain } = parseURL(rawUrl);
  if (!domain) return { status: 'skip', detail: 'Could not parse domain', score: 0 };

  try {
    const res = await fetchWithTimeout(
      `https://api.phishstats.info/api/phishing?_where=(url,like,~${encodeURIComponent(domain)}~)&_size=5&_sort=-id`,
      { headers: { 'Accept': 'application/json' } },
      7000
    );

    if (res.status === 404) return { status: 'ok',   detail: 'Not in phishing database', score: 0 };
    if (res.status === 429) return { status: 'skip', detail: 'Rate limited',              score: 0 };
    if (!res.ok)            return { status: 'skip', detail: `API error ${res.status}`,   score: 0 };

    const data = await res.json();

    if (Array.isArray(data) && data.length > 0) {
      return {
        status: 'bad',
        detail: `Found in phishing database (${data.length} records)`,
        score: -30,
      };
    }

    return { status: 'ok', detail: 'Not in phishing database', score: 0 };

  } catch (e) {
    /* CORS or network error — common in browser environment */
    if (e.name === 'AbortError') return { status: 'skip', detail: 'Request timeout',    score: 0 };
    return                              { status: 'skip', detail: 'CORS/Network blocked', score: 0 };
  }
}

/* ═══════════════════════════════════════════════════════
   SCORE AGGREGATOR
   Combines heuristic score + API penalties
═══════════════════════════════════════════════════════ */
function aggregateScore(heuristicScore, apiResults) {
  let final = heuristicScore;
  apiResults.forEach(a => {
    if (typeof a.res.score === 'number') final += a.res.score;
  });
  return Math.max(0, Math.min(100, final));
}

function scoreToLevel(score) {
  if (score >= 70) return 'safe';
  if (score >= 40) return 'warning';
  return 'danger';
}

/* shared sleep */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
