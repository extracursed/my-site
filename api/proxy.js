// Vercel Function: CORS-прокси для LarpMusic (ЛарпМузыка).
// GET  https://www.extravisualdlc.online/api/proxy?url=https://...
// POST https://www.extravisualdlc.online/api/proxy  (body: url=... в form или JSON {url})
// Пропускает только хосты из белого списка — это не open-proxy.
// Пробрасывает x-auth-token/authorization/content-type — нужно для GraphQL (Zvuk).

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
  "mzstatic.com",
  // Zvuk (zvuk.com) — поиск + полные mp3, анонимный токен
  "zvuk.com"
];

// заголовки, которые пробрасываем от клиента к цели
const FWD_HEADERS = ["x-auth-token", "authorization", "content-type", "accept", "accept-language"];
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

module.exports = async (req, res) => {
  for (const k in CORS) res.setHeader(k, CORS[k]);
  if (req.method === "OPTIONS") return res.status(204).end();

  // GET: ?url=... ; POST: url=... в form-body или поле url в JSON
  let target = (req.query && req.query.url) || "";
  if (!target) {
    const b = req.body;
    if (typeof b === "string") {
      const m = b.match(/(?:^|&)url=([^&]*)/);
      if (m) target = decodeURIComponent(m[1].replace(/\+/g, " "));
    } else if (b && typeof b === "object" && typeof b.url === "string") {
      target = b.url;
    }
  }
  if (!target) return res.status(400).send("Добавь параметр ?url=https://...");

  let t;
  try { t = new URL(target); } catch (e) { return res.status(400).send("Некорректный URL"); }
  const host = String(t.hostname || "").toLowerCase();
  if (t.protocol !== "https:" || !ALLOW.some((h) => host === h || host.endsWith("." + h))) {
    return res.status(403).send("Хост вне белого списка: " + host);
  }

  // заголовки на цель: свои от клиента + Origin/Referer как у сайта-источника
  const fwd = { "user-agent": String(req.headers["user-agent"] || CHROME_UA) };
  for (const k of FWD_HEADERS) {
    if (req.headers[k]) fwd[k] = String(req.headers[k]);
  }
  fwd.origin = t.origin;
  fwd.referer = t.origin + "/";

  const init = { method: req.method === "POST" ? "POST" : "GET", redirect: "follow", headers: fwd };
  if (req.method === "POST") {
    const ct = String(req.headers["content-type"] || "");
    if (typeof req.body === "string") {
      init.body = req.body;
    } else if (req.body != null) {
      // Vercel уже распарсил body — собираем обратно под исходный content-type
      init.body = /json/i.test(ct) ? JSON.stringify(req.body)
                                   : new URLSearchParams(req.body).toString();
    } else {
      init.body = "";
    }
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
