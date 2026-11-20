import { J } from "./_auth.js";
import { ownerOf, userFromToken, scopeOf, loadClub, clubInfo, hitLimit, wibToday } from "./staff.js";
import { tokenIds } from "./portal.js";

// ===== Champion: PR latihan di rumah (cek form via kamera) + absen PR =====
// Anak / orang tua : header X-Portal-Token (token hasil verifikasi nama anak di Portal Orang Tua, domain yang sama)
// Admin klub       : X-Dojang-Admin-Token (+ X-Target-Club untuk Super Admin)
// Pelatih          : X-Dojang-Token (hanya murid di unit yang diberikan)
// Koleksi (semua PROTECTED, tidak ikut sinkron /api/all):
//   champion_pr   : PR aktif per klub (id = clubId)
//   champion      : hasil latihan (tanpa foto)
//   champion_foto : foto posisi terbaik, dihapus otomatis setelah 60 hari
// kategori tiap latihan (kuat = kekuatan, lentur = kelenturan); dipakai untuk PR acak yang seimbang
const CAT = {
  kuda: "kuat", squat: "kuat", lompat: "kuat", plank: "kuat", bridge: "kuat", samping: "kuat", flamingo: "kuat",
  pushup: "kuat", situp: "kuat", superman: "kuat", wallsit: "kuat", lari: "kuat", jinjit: "kuat",
  cossack: "lentur", split: "lentur", lunge: "lentur", kupu: "lentur", yeop: "lentur", jerapah: "lentur", apchagi: "lentur", ayun: "lentur"
};
const EX = new Set(Object.keys(CAT));

// ===== PR acak per anak =====
// Pilihan acak ditentukan dari (id murid + seed PR [+ tanggal bila diacak harian]), jadi selalu sama di HP anak maupun di halaman pelatih.
const fnv = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = seed => { let a = seed; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
export function itemsFor(pr, sid, date) {
  const items = Array.isArray(pr.items) ? pr.items : [];
  if (pr.mode !== "acak" || items.length < 2) return items;
  const n = Math.max(1, Math.min(pr.n || 3, items.length));
  const R = rng(fnv(String(sid).toLowerCase() + "|" + (pr.seed || "") + (pr.harian ? "|" + date : "")));
  const shuf = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const kuat = shuf(items.filter(x => CAT[x.k] === "kuat")), lentur = shuf(items.filter(x => CAT[x.k] !== "kuat"));
  const out = [];
  let turn = R() < 0.5;
  while (out.length < n && (kuat.length || lentur.length)) {
    out.push(((turn && kuat.length) || !lentur.length ? kuat : lentur).shift());
    turn = !turn;
  }
  return out;
}
const FOTO_DAYS = 60;
const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const dateOf = ts => new Date(ts + 7 * 3600e3).toISOString().slice(0, 10);
const NOSTORE = { "Cache-Control": "no-store" };

async function kidCtx(env, request) {
  const ids = await tokenIds(env, request.headers.get("X-Portal-Token"));
  if (!ids || !ids.length) return { error: "verify", status: 401 };
  const list = ids.slice(0, 20);
  const ph = list.map(() => "?").join(",");
  const rs = await env.DB.prepare(`SELECT id,data FROM docs WHERE coll='students' AND lower(id) IN (${ph})`).bind(...list).all();
  const kids = [];
  let clubId = "";
  for (const r of rs.results) {
    let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
    if (!d.clubId) continue;
    if (!clubId) clubId = d.clubId;
    if (d.clubId !== clubId) continue;
    kids.push({ id: r.id, n: d.n || r.id, unit: d.unit || "Utama", cuti: !!d.cuti });
  }
  if (!kids.length) return { error: "verify", status: 401 };
  const c = await loadClub(env, clubId);
  if (c.error) return { error: c.error, status: c.status };
  return { clubId, club: c.club, kids };
}

async function staffCtx(env, request) {
  if (request.headers.get("X-Dojang-Token")) {
    const u = await userFromToken(request, env);
    if (!u) return { error: "Sesi pelatih berakhir. Silakan masuk lagi di Dojang HQ.", status: 401 };
    const scope = await scopeOf(env, u);
    const canEdit = !!(u.perm && (u.perm.absen || u.perm.nilai));
    return { clubId: u.clubId, club: u._club, scope, canEdit, who: u.name || u.username, role: "coach" };
  }
  const o = await ownerOf(env, request);
  if (!o.ok) return { error: o.error, status: o.status };
  const c = await loadClub(env, o.clubId);
  if (c.error) return { error: c.error, status: c.status };
  return { clubId: o.clubId, club: c.club, scope: null, canEdit: true, who: o.who, role: "owner" };
}

async function getPR(env, clubId) {
  const row = await env.DB.prepare("SELECT data FROM docs WHERE coll='champion_pr' AND id=?").bind(clubId).first();
  if (!row) return { items: [], note: "", mode: "sama" };
  try {
    const d = JSON.parse(row.data);
    return { items: Array.isArray(d.items) ? d.items : [], note: d.note || "", mode: d.mode === "acak" ? "acak" : "sama", n: d.n || 3, harian: !!d.harian, seed: d.seed || "", updatedAt: d.updatedAt || "", by: d.by || "" };
  } catch (e) { return { items: [], note: "", mode: "sama" }; }
}

async function resultsOn(env, clubId, tgl) {
  const rs = await env.DB.prepare(
    "SELECT id,data FROM docs WHERE coll='champion' AND json_extract(data,'$.clubId')=? AND json_extract(data,'$.date')=?"
  ).bind(clubId, tgl).all();
  const out = [];
  for (const r of rs.results) { try { out.push({ id: r.id, ...JSON.parse(r.data) }); } catch (e) {} }
  return out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  if (mode === "kid") {
    const k = await kidCtx(env, request);
    if (k.error) return J({ error: k.error }, k.status);
    const today = wibToday();
    const mine = new Set(k.kids.map(x => String(x.id)));
    const res = (await resultsOn(env, k.clubId, today)).filter(r => mine.has(String(r.sid)));
    const pr = await getPR(env, k.clubId);
    return new Response(JSON.stringify({
      club: await clubInfo(env, k.club),
      kids: k.kids.map(x => ({ ...x, pr: itemsFor(pr, x.id, today) })),
      pr: { note: pr.note, mode: pr.mode },
      today: res.map(r => ({ sid: r.sid, ex: r.ex, skor: r.skor }))
    }), { headers: { "content-type": "application/json", ...NOSTORE } });
  }

  if (mode === "staff") {
    const s = await staffCtx(env, request);
    if (s.error) return J({ error: s.error }, s.status);
    const q = url.searchParams.get("tgl");
    const tgl = okDate(q) ? q : wibToday();
    const rs = await env.DB.prepare("SELECT id,data FROM docs WHERE coll='students' AND json_extract(data,'$.clubId')=?").bind(s.clubId).all();
    const students = [];
    for (const r of rs.results) {
      let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
      if (d.cuti) continue;
      if (s.scope && !s.scope.ids.has(r.id)) continue;
      students.push({ id: r.id, n: d.n || r.id, unit: d.unit || "Utama" });
    }
    const pr = await getPR(env, s.clubId);
    for (const st of students) st.pr = itemsFor(pr, st.id, tgl);
    const allow = new Set(students.map(x => String(x.id)));
    const results = (await resultsOn(env, s.clubId, tgl))
      .filter(r => !s.scope || allow.has(String(r.sid)))
      .map(({ clubId, ...r }) => r);
    const { seed, ...prOut } = pr;
    return J({ tgl, club: await clubInfo(env, s.club), role: s.role, who: s.who, canEdit: s.canEdit, pr: prOut, students, results });
  }

  if (mode === "foto") {
    const s = await staffCtx(env, request);
    if (s.error) return J({ error: s.error }, s.status);
    const id = clip(url.searchParams.get("id"), 200);
    const row = await env.DB.prepare("SELECT data FROM docs WHERE coll='champion_foto' AND id=?").bind(id).first();
    if (!row) return J({ foto: "" });
    let d; try { d = JSON.parse(row.data); } catch (e) { return J({ foto: "" }); }
    if (d.clubId !== s.clubId) return J({ error: "forbidden" }, 403);
    if (s.scope && !s.scope.ids.has(String(d.sid))) return J({ error: "forbidden" }, 403);
    return J({ foto: d.foto || "" });
  }

  return J({ error: "mode tidak dikenal" }, 400);
}

export async function onRequestPost({ request, env }) {
  if (Number(request.headers.get("content-length") || 0) > 300000) return J({ error: "Data terlalu besar" }, 413);
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object") return J({ error: "Data tidak valid" }, 400);

  // ----- Anak mengirim hasil latihan (= absen PR) -----
  if (b.action === "result") {
    const k = await kidCtx(env, request);
    if (k.error) return J({ error: k.error }, k.status);
    const kid = k.kids.find(x => String(x.id).toLowerCase() === String(b.sid || "").toLowerCase());
    if (!kid) return J({ error: "Murid tidak cocok dengan portal ini." }, 403);
    if (!EX.has(b.ex)) return J({ error: "Latihan tidak dikenal" }, 400);
    const uid = String(b.uid || "");
    if (!/^[a-z0-9]{6,24}$/.test(uid)) return J({ error: "Data tidak valid" }, 400);
    if (!(await hitLimit(env, request, "chp", 60, 60 * 60000, kid.id)))
      return J({ error: "Terlalu banyak kiriman. Coba lagi nanti." }, 429);
    const now = Date.now();
    let ts = parseInt(b.t) || now;
    if (ts > now + 600e3 || ts < now - 3 * 864e5) ts = now;
    const date = dateOf(ts);
    const id = `${k.clubId}__${date}__${kid.id}__${uid}`.slice(0, 200);
    const foto = typeof b.foto === "string" && b.foto.startsWith("data:image/jpeg;base64,") && b.foto.length < 120000 ? b.foto : "";
    const pr = await getPR(env, k.clubId);
    const doc = {
      clubId: k.clubId, date, ts, sid: kid.id, n: kid.n, unit: kid.unit,
      ex: b.ex, exName: clip(b.exName, 50), hasil: clip(b.hasil, 80),
      skor: Math.max(0, Math.min(100, parseInt(b.skor) || 0)), bintang: Math.max(0, Math.min(3, parseInt(b.bintang) || 0)),
      inPr: itemsFor(pr, kid.id, date).some(x => x.k === b.ex), foto: !!foto
    };
    await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('champion',?,?)").bind(id, JSON.stringify(doc)).run();
    if (foto) {
      await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('champion_foto',?,?)")
        .bind(id, JSON.stringify({ clubId: k.clubId, sid: kid.id, date, foto })).run();
      if (Math.random() < 0.05) {   // bersih-bersih foto lama milik klub ini
        const old = dateOf(now - FOTO_DAYS * 864e5);
        await env.DB.prepare("DELETE FROM docs WHERE coll='champion_foto' AND json_extract(data,'$.clubId')=? AND json_extract(data,'$.date')<?").bind(k.clubId, old).run();
      }
    }
    return new Response(JSON.stringify({ ok: true, date }), { headers: { "content-type": "application/json", ...NOSTORE } });
  }

  // ----- Pelatih / admin mengatur PR aktif -----
  if (b.action === "setpr") {
    const s = await staffCtx(env, request);
    if (s.error) return J({ error: s.error }, s.status);
    if (!s.canEdit) return J({ error: "Akun ini belum diberi izin mengatur PR." }, 403);
    const items = [];
    for (const x of Array.isArray(b.items) ? b.items.slice(0, 30) : []) {
      if (!x || !EX.has(x.k) || items.some(y => y.k === x.k)) continue;
      items.push({ k: x.k, t: Math.max(1, Math.min(600, parseInt(x.t) || 1)) });
    }
    const old = await getPR(env, s.clubId);
    const mode = b.mode === "acak" ? "acak" : "sama";
    const seed = b.reshuffle || !old.seed ? Math.random().toString(36).slice(2, 10) : old.seed;
    const doc = {
      clubId: s.clubId, items, note: clip(b.note, 300), mode, n: Math.max(1, Math.min(6, parseInt(b.n) || 3)), harian: !!b.harian, seed,
      updatedAt: new Date().toISOString(), by: clip(s.who, 60)
    };
    await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('champion_pr',?,?)").bind(s.clubId, JSON.stringify(doc)).run();
    const { clubId: _c, seed: _s, ...out } = doc;
    return J({ ok: true, pr: out });
  }

  return J({ error: "Aksi tidak dikenal" }, 400);
}
