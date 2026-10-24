// Vercel Function: CORS-прокси для LarpMusic (ЛарпМузыка).
// GET  https://www.extravisualdlc.online/api/proxy?url=https://...
// POST https://www.extravisualdlc.online/api/proxy  (body: url=... в x-www-form-urlencoded)
// Пропускает только хосты из белого списка — это не open-proxy.

const ALLOW = [
  "api.vk.com",
  "music.yandex.net", "login.yandex.ru",
  "api.audius.co", "audius.co",            // discovery-ноды + creator-ноды (аудио-стримы)
  "api.spotify.com", "accounts.spotify.com",
  "archive.org",                            // и *.us.archive.org (загрузки mp3)
  // YouTube через публичные инстансы Piped (полные треки)
  "pipedapi.kavin.rocks", "pipedapi.adminforge.de", "api.piped.private.coffee",
  "pipedapi.reallyaweso.me", "pipedapi.drgns.space", "pipedapi.ducks.party",
  // SoundCloud
  "soundcloud.com", "sndcdn.com",
  // прямые mp3-URL с YouTube (аудио-потоки из Piped /streams)
  "googlevideo.com",
  // превью iTunes (30с — крайний случай)
  "mzstatic.com"
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

module.exports = async (req, res) => {
  for (const k in CORS) res.setHeader(k, CORS[k]);
  if (req.method === "OPTIONS") return res.status(204).end();

  // GET: ?url=... ; POST: url=... в body
  let target = (req.query && req.query.url) || "";
  if (!target && req.method === "POST") {
    const body = typeof req.body === "string" ? req.body : "";
    const m = body.match(/(?:^|&)url=([^&]*)/);
    if (m) target = decodeURIComponent(m[1].replace(/\+/g, " "));
  }
  if (!target) return res.status(400).send("Добавь параметр ?url=https://...");

  let t;
  try { t = new URL(target); } catch (e) { return res.status(400).send("Некорректный URL"); }
  const host = String(t.hostname || "").toLowerCase();
  if (t.protocol !== "https:" || !ALLOW.some((h) => host === h || host.endsWith("." + h))) {
    return res.status(403).send("Хост вне белого списка: " + host);
  }

  const init = { method: req.method === "POST" ? "POST" : "GET", redirect: "follow" };
  if (req.method === "POST") {
    init.body = typeof req.body === "string" ? req.body : "";
    init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  }

  try {
    const r = await fetch(t.href, init);
    res.setHeader("Content-Type", r.headers.get("Content-Type") || "application/json; charset=utf-8");
    const len = r.headers.get("Content-Length");
    if (len) res.setHeader("Content-Length", len);
    res.status(r.status);
    // стримим тело как есть — mp3 уходят постранично, без буферизации в память
    if (r.body) {
      try {
        const { Readable } = require("stream");
        Readable.fromWeb(r.body).pipe(res);
        return;
      } catch (e) { /* падаем в буферизацию ниже */ }
    }
    return res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    return res.status(502).send("Ошибка прокси: " + (e && e.message ? e.message : String(e)));
  }
};
