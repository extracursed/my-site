// Vercel Edge Function: CORS-прокси для LarpMusic (ЛарпМузыка).
// GET  https://www.extravisualdlc.online/api/proxy?url=https://...
// POST https://www.extravisualdlc.online/api/proxy  (body: url=... или JSON {url})
// Пропускает только хосты из белого списка — это не open-proxy.
// Пробрасывает x-auth-token/authorization/content-type/cookie — нужно для GraphQL (Zvuk).
//
// Edge runtime: другой пул исходящих IP, чем у Node serverless.
// Антибот ServicePipe (zvuk.com) отдаёт JS-челлендж, в котором ГОТОВЫЕ куки
// spid/spsn лежат прямо в HTML (is_captcha:false) — извлекаем их и повторяем
// запрос с Cookie. Поддержаны: прямой HTML-челлендж и петля редиректов (в т.ч.
// с сбором Set-Cookie по цепочке).
//
// debug=chain — режим отладки: цепочка редиректов с этого IP как JSON.

export const config = { runtime: 'edge' };

const ALLOW = [
  'api.vk.com',
  'music.yandex.net', 'login.yandex.ru',
  'api.audius.co', 'audius.co',
  'api.spotify.com', 'accounts.spotify.com',
  'archive.org',
  'pipedapi.kavin.rocks', 'pipedapi.adminforge.de', 'api.piped.private.coffee',
  'pipedapi.reallyaweso.me', 'pipedapi.drgns.space', 'pipedapi.ducks.party',
  'soundcloud.com', 'sndcdn.com',
  'googlevideo.com',
  'mzstatic.com',
  'zvuk.com'
];

const FWD_HEADERS = ['x-auth-token', 'authorization', 'content-type', 'accept', 'accept-language', 'cookie'];
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

const CHALLENGE_RE = /get_cookie_spid|servicepipe\.tech|js-challenge/i;

function cookiesFrom (html) {
  // generic: вытаскиваем ВСЕ get_cookie_*() из HTML-челленджа (spid/spsc/spsn/…)
  const out = [];
  const re = /function get_cookie_(\w+)\(\)\s*\{\s*return\s+"([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const val = m[2];
    out.push(val.indexOf('=') >= 0 ? val : (m[1] + '=' + val));
  }
  return out;
}

function setCookiesFrom (headerValue) {
  // из (склеенных) Set-Cookie берём только известные ServicePipe-куки: spid/spsc/spsn
  const out = [];
  const re = /\b(spid|spsc|spsn)=([^;,\s]+)/g;
  let m;
  while ((m = re.exec(String(headerValue || '')))) out.push(m[1] + '=' + m[2]);
  return out;
}

function dedupeByName (list) {
  // первое вхождение имени выигрывает (пара spid+spsc из одной выдачи)
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const name = String(c).split('=')[0];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(c);
  }
  return out;
}

function corsResp (status, body, contentType) {
  return new Response(body, {
    status,
    headers: Object.assign({ 'Content-Type': contentType || 'text/plain; charset=utf-8' }, CORS)
  });
}

function passthrough (r) {
  const out = new Headers(CORS);
  const c = r.headers.get('content-type');
  if (c) out.set('content-type', c);
  const len = r.headers.get('content-length');
  if (len) out.set('content-length', len);
  return new Response(r.body, { status: r.status, headers: out });
}

export default async function handler (request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let raw = '';
  if (request.method === 'POST') raw = await request.text();

  const pageUrl = new URL(request.url);
  let target = pageUrl.searchParams.get('url') || '';
  if (!target && raw) {
    const ct = request.headers.get('content-type') || '';
    if (/json/i.test(ct)) {
      try {
        const b = JSON.parse(raw);
        if (b && typeof b.url === 'string') target = b.url;
      } catch (e) { /* не JSON — смотрим form */ }
    }
    if (!target) {
      const m = raw.match(/(?:^|&)url=([^&]*)/);
      if (m) target = decodeURIComponent(m[1].replace(/\+/g, ' '));
    }
  }
  if (!target) return corsResp(400, 'Добавь параметр ?url=https://...');

  let t;
  try { t = new URL(target); } catch (e) { return corsResp(400, 'Некорректный URL'); }
  const host = String(t.hostname || '').toLowerCase();
  if (t.protocol !== 'https:' || !ALLOW.some(h => host === h || host.endsWith('.' + h))) {
    return corsResp(403, 'Хост вне белого списка: ' + host);
  }

  const fwd = new Headers();
  fwd.set('user-agent', request.headers.get('user-agent') || CHROME_UA);
  for (const k of FWD_HEADERS) {
    const v = request.headers.get(k);
    if (v) fwd.set(k, v);
  }
  fwd.set('origin', t.origin);
  fwd.set('referer', t.origin + '/');

  const init = {
    method: request.method === 'POST' ? 'POST' : 'GET',
    headers: fwd,
    body: request.method === 'POST' ? raw : undefined
  };

  /* ---- debug=chain: цепочка редиректов с этого IP как JSON ---- */
  if (pageUrl.searchParams.get('debug') === 'chain') {
    const hops = [];
    let cur = target;
    for (let i = 0; i < 6; i++) {
      let r;
      try { r = await fetch(cur, Object.assign({}, init, { redirect: 'manual' })); }
      catch (e) { hops.push({ i, err: String((e && e.message) || e) }); break; }
      const ct2 = r.headers.get('content-type') || '';
      let head = '';
      try {
        if (/text\/html|json|text\//.test(ct2)) head = (await r.text()).slice(0, 500);
      } catch (e) {}
      const loc = r.headers.get('location');
      hops.push({
        i,
        url: cur,
        status: r.status,
        location: loc ? new URL(loc, cur).href : null,
        ct: ct2,
        setCookie: (r.headers.get('set-cookie') || '').slice(0, 300) || null,
        head
      });
      if (r.status >= 300 && r.status < 400 && loc) { cur = new URL(loc, cur).href; continue; }
      break;
    }
    return new Response(JSON.stringify({ hops }, null, 2), {
      status: 200,
      headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS)
    });
  }

  function send (cookies, redirectMode) {
    const h = new Headers(fwd);
    if (cookies && cookies.length) h.set('cookie', cookies.join('; '));
    return fetch(target, Object.assign({}, init, { headers: h, redirect: redirectMode }));
  }

  try {
    /* 1) обычная попытка (follow) */
    let r = null;
    try {
      r = await send(null, 'follow');
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (!/redirect/i.test(msg)) throw e;
      // 2) петля редиректов — идём цепочкой вручную, собираем куки
      const jar = [];
      let cur = target;
      for (let i = 0; i < 6; i++) {
        let hop;
        try {
          hop = await fetch(cur, Object.assign({}, init, { redirect: 'manual' }));
        } catch (e2) { break; }
        const sc = hop.headers.get('set-cookie');
        if (sc) jar.push(...setCookiesFrom(sc));
        const loc = hop.headers.get('location');
        if (hop.status >= 300 && hop.status < 400 && loc) { cur = new URL(loc, cur).href; continue; }
        r = hop;
        break;
      }
      if (!r) {
        if (jar.length) r = await send(dedupeByName(jar), 'follow');
        else return corsResp(502, 'Ошибка прокси: цепочка редиректов');
      } else if (jar.length) {
        // есть Set-Cookie из петли — пробуем с ними, прежде чем разбирать тело
        try {
          const withJar = await send(dedupeByName(jar), 'follow');
          if (withJar.status === 200 && !/text\/html/.test(withJar.headers.get('content-type') || '')) {
            return passthrough(withJar);
          }
          r = withJar;
        } catch (e) { /* остаёмся с r */ }
      }
    }

    /* 3) HTML-ответ: может быть челленджем ServicePipe (в нём готовые куки) */
    const ct = r.headers.get('content-type') || '';
    if (r.status === 200 && /text\/html/.test(ct)) {
      const html = await r.text();
      if (CHALLENGE_RE.test(html)) {
        const ck = cookiesFrom(html);
        if (ck.length) {
          const r2 = await send(ck, 'follow');
          const ct2 = r2.headers.get('content-type') || '';
          if (!(r2.status === 200 && /text\/html/.test(ct2))) return passthrough(r2);
          // снова HTML — возможно, новый челлендж; отдаём как есть (одна попытка, без петли)
          const html2 = await r2.text();
          return corsResp(200, html2, 'text/html; charset=utf-8');
        }
      }
      return corsResp(r.status, html, ct);
    }

    /* 4) обычный ответ (json/mp3/…) — потоком */
    return passthrough(r);
  } catch (e) {
    return corsResp(502, 'Ошибка прокси: ' + ((e && e.message) ? e.message : String(e)));
  }
}
