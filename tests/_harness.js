// Peralatan test: menjalankan KODE API ASLI (functions/api) dengan database SQLite di memori (node:sqlite),
// meniru D1 Cloudflare. Tidak perlu jaringan atau Cloudflare. Dipakai oleh tenant-isolation.test.js.
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let DatabaseSync = null;
try { ({ DatabaseSync } = require("node:sqlite")); } catch (e) { /* Node < 22.5: test yang butuh DB dilewati */ }
const HAS_SQLITE = !!DatabaseSync;

function makeDB() {
  const sq = new DatabaseSync(":memory:");
  sq.exec("CREATE TABLE docs(coll TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(coll,id))");
  const DB = {
    prepare(sql) {
      const st = sq.prepare(sql); let a = [];
      const o = {
        bind(...x) { a = x; return o; },
        async first() { return st.get(...a) || null; },
        async all() { return { results: st.all(...a) }; },
        async run() { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; }
      };
      return o;
    }
  };
  return { sq, DB };
}

const API = path.join(__dirname, "..", "functions", "api");
const mods = {};
const load = async n => mods[n] || (mods[n] = await import(pathToFileURL(path.join(API, n + ".js")).href));

// Buat dunia baru: database kosong + dua klub contoh (garuda, macan) + Super Admin.
async function world(extraEnv = {}) {
  const { sq, DB } = makeDB();
  const env = { DB, TOKEN_SECRET: "rahasia-test-panjang-1234567890abcdef", SUPERADMIN_PIN: "super-test-2026-abc", ...extraEnv };
  const auth = await load("_auth");
  const put = (coll, id, d) => sq.prepare("INSERT OR REPLACE INTO docs VALUES(?,?,?)").run(coll, id, JSON.stringify(d));
  put("clubs", "garuda", { name: "Garuda", adminUser: "garuda", adminPinHash: await auth.hashPin("pin-garuda-1"), plan: "Pro", expiresAt: "2099-01-01" });
  put("clubs", "macan", { name: "Macan", adminUser: "macan", adminPinHash: await auth.hashPin("pin-macan-2"), plan: "Pro", expiresAt: "2099-01-01" });

  // meniru router Cloudflare Pages Functions: /api/<nama> dan /api/docs/<coll>/<id>
  async function call(method, url, { headers = {}, body, ip = "10.0.0.1" } = {}) {
    const u = new URL(url, "http://x");
    let name = u.pathname.replace(/^\/api\//, ""), params = {};
    const m = name.match(/^docs\/([^/]+)\/([^/]+)$/);
    if (m) { name = "docs/[coll]/[id]"; params = { coll: m[1], id: decodeURIComponent(m[2]) }; }
    const mod = await load(name);
    const fn = mod["onRequest" + method[0] + method.slice(1).toLowerCase()];
    if (!fn) return { status: 404, body: {} };
    const h = new Headers({ "CF-Connecting-IP": ip, ...headers });
    if (body !== undefined) h.set("content-type", "application/json");
    const request = new Request("http://x" + u.pathname + u.search, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await fn({ request, env, params });
    let json = null; const txt = await res.text(); try { json = JSON.parse(txt); } catch (e) { /* bukan JSON */ }
    return { status: res.status, body: json, text: txt };
  }
  const login = async (user, pin, ip) => {
    const r = await call("POST", "/api/login", { body: { user, pin }, ip });
    return r.body && r.body.token ? { "X-Dojang-Admin-Token": r.body.token } : null;
  };
  return { env, sq, call, login, put, dbRow: (coll, id) => { const r = sq.prepare("SELECT data FROM docs WHERE coll=? AND id=?").get(coll, id); return r ? JSON.parse(r.data) : null; } };
}

module.exports = { HAS_SQLITE, world };
