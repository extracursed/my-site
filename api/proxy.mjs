// Vercel Edge Function: CORS-прокси для LarpMusic (ЛарпМузыка).
// GET  https://www.extravisualdlc.online/api/proxy?url=https://...
// POST https://www.extravisualdlc.online/api/proxy  (body: url=... или JSON {url})
// Пропускает только хосты из белого списка — это не open-proxy.
// Пробрасывает x-auth-token/authorization/content-type — нужно для GraphQL (Zvuk).
//
// Edge runtime: другой пул исходящих IP, чем у Node serverless — Zvuk/ServicePipe
// пропускает эти адреса (Node-вариант получал 418/502).

export const config = { runtime: 'edge' };

const ALLOW = [
  'api.vk.com',
  'music.yandex.net', 'login.yandex.ru',
  'api.audius.co', 'audius.co',            // discovery-ноды + creator-ноды (аудио-стримы)
  'api.spotify.com', 'accounts.spotify.com',
  'archive.org',                            // и *.us.archive.org (загрузки mp3)
  // YouTube через публичные инстансы Piped (полные треки)
  'pipedapi.kavin.rocks', 'pipedapi.adminforge.de', 'api.piped.private.coffee',
  'pipedapi.reallyaweso.me', 'pipedapi.drgns.space', 'pipedapi.ducks.party',
  // SoundCloud
  'soundcloud.com', 'sndcdn.com',
  // прямые mp3-URL с YouTube (аудио-потоки из Piped /streams)
  'googlevideo.com',
  // превью iTunes (30с — крайний случай)
  'mzstatic.com',
  // Zvuk (zvuk.com) — поиск + полные mp3, анонимный токен
  'zvuk.com'
];

// заголовки, которые пробрасываем от клиента к цели
const FWD_HEADERS = ['x-auth-token', 'authorization', 'content-type', 'accept', 'accept-language'];
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

export default async function handler (request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let raw = '';
  if (request.method === 'POST') raw = await request.text();

  // GET: ?url=... ; POST: url=... в form-body или поле url в JSON
  let target = new URL(request.url).searchParams.get('url') || '';
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
  if (!target) return new Response('Добавь параметр ?url=https://...', { status: 400, headers: CORS });

  let t;
  try { t = new URL(target); } catch (e) { return new Response('Некорректный URL', { status: 400, headers: CORS }); }
  const host = String(t.hostname || '').toLowerCase();
  if (t.protocol !== 'https:' || !ALLOW.some(h => host === h || host.endsWith('.' + h))) {
    return new Response('Хост вне белого списка: ' + host, { status: 403, headers: CORS });
  }

  // заголовки на цель: свои от клиента + Origin/Referer как у сайта-источника
  const fwd = new Headers();
  fwd.set('user-agent', request.headers.get('user-agent') || CHROME_UA);
  for (const k of FWD_HEADERS) {
    const v = request.headers.get(k);
    if (v) fwd.set(k, v);
  }
  fwd.set('origin', t.origin);
  fwd.set('referer', t.origin + '/');

  const init = { method: request.method === 'POST' ? 'POST' : 'GET', redirect: 'follow', headers: fwd };
  if (request.method === 'POST') init.body = raw;

  try {
    const r = await fetch(t.href, init);
    const out = new Headers(CORS);
    const ct = r.headers.get('content-type');
    if (ct) out.set('content-type', ct);
    const len = r.headers.get('content-length');
    if (len) out.set('content-length', len);
    // тело транслируется потоком — mp3 без буферизации
    return new Response(r.body, { status: r.status, headers: out });
  } catch (e) {
    return new Response('Ошибка прокси: ' + (e && e.message ? e.message : String(e)),
      { status: 502, headers: CORS });
  }
}
