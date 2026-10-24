// Vercel Function: CORS-прокси для LarpMusic (ЛарпМузыка).
// GET  https://www.extravisualdlc.online/api/proxy?url=https://...
// POST https://www.extravisualdlc.online/api/proxy  (body: url=... в x-www-form-urlencoded)
// Пропускает только хосты из белого списка — это не open-proxy.

const ALLOW = [
  "api.vk.com",
  "music.yandex.net", "login.yandex.ru",
  "api.audius.co", "discoveryprovider.audius.co",
  "discoveryprovider2.audius.co", "discoveryprovider3.audius.co", "discoveryprovider4.audius.co",
  "api.spotify.com", "accounts.spotify.com",
  "archive.org",
  // YouTube через публичные инстансы Piped (полные треки)
  "pipedapi.kavin.rocks", "pipedapi.adminforge.de", "api.piped.private.coffee",
  "pipedapi.reallyaweso.me", "pipedapi.drgns.space", "pipedapi.ducks.party",
  // SoundCloud
  "soundcloud.com", "sndcdn.com"
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
    res.status(r.status);
    return res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    return res.status(502).send("Ошибка прокси: " + (e && e.message ? e.message : String(e)));
  }
};
