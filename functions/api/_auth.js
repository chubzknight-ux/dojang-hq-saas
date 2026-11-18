export const J = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });

export const cleanSlug = s =>
  String(s || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");

// ===== Index database =====
// Hampir semua query mencari "semua dokumen milik klub X" lewat json_extract(data,'$.clubId').
// Tanpa index, D1 membaca SELURUH tabel (semua klub) di setiap sinkron — makin banyak klub, makin lambat & mahal.
// Index ekspresi ini dibuat otomatis sekali per instance worker (IF NOT EXISTS = tanpa biaya bila sudah ada).
let schemaReady = false;
export async function ensureSchema(env) {
  if (schemaReady || !env.DB) return;
  schemaReady = true;
  try {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS docs_club_coll ON docs(json_extract(data,'$.clubId'), coll)").run();
  } catch (e) { schemaReady = false; /* jangan ganggu permintaan bila gagal; dicoba lagi lain kali */ }
}

export async function authenticate(env, req) {
  await ensureSchema(env);
  const user = String(req.headers.get("X-Dojang-User") || "").trim().toLowerCase();
  const pin = String(req.headers.get("X-Dojang-Pin") || "").trim();
  const targetClub = cleanSlug(req.headers.get("X-Target-Club") || "");

  const saUser = String(env.SUPERADMIN_USER || "superadmin").trim().toLowerCase();
  // Tidak ada PIN bawaan: Super Admin baru aktif setelah SUPERADMIN_PIN diisi di Cloudflare (disarankan kalimat sandi panjang)
  const saPin = String(env.SUPERADMIN_PIN || env.DOJANG_PIN || "").trim();

  // Batas percobaan salah per perangkat (IP): 10x / 15 menit
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const rlKey = "adm:" + ip;
  const rlRow = user && pin ? await env.DB.prepare("SELECT data FROM docs WHERE coll='staff_rl' AND id=?").bind(rlKey).first() : null;
  const rl = rlRow ? JSON.parse(rlRow.data) : null;
  if (rl && rl.n >= 10 && Date.now() - rl.t < 15 * 60000) {
    return { ok: false, status: 429, error: "Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi." };
  }
  const fail = async (status, error) => {
    const cur = rl && Date.now() - rl.t < 15 * 60000 ? { n: rl.n + 1, t: rl.t } : { n: 1, t: Date.now() };
    if (user && pin) await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('staff_rl',?,?)").bind(rlKey, JSON.stringify(cur)).run();
    return { ok: false, status, error };
  };
  const eq = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

  if (user && pin && saPin && user === saUser && eq(pin, saPin)) {
    let club = null;
    if (targetClub) {
      const row = await env.DB.prepare("SELECT id, data FROM docs WHERE coll = 'clubs' AND id = ?").bind(targetClub).first();
      if (row) club = { id: row.id, ...JSON.parse(row.data) };
    }
    return { ok: true, role: "superadmin", clubId: club ? club.id : null, club };
  }

  if (!user || !pin) return { ok: false, status: 403, error: "Username atau PIN kosong" };

  const rs = await env.DB.prepare(
    "SELECT id, data FROM docs WHERE coll = 'clubs' AND lower(trim(coalesce(nullif(json_extract(data,'$.adminUser'),''), id))) = ?"
  ).bind(user).all();
  for (const r of rs.results) {
    const c = JSON.parse(r.data);
    const cUser = String(c.adminUser || r.id || "").trim().toLowerCase();
    const cPin = String(c.adminPin || "").trim();
    if (cUser === user && cPin && eq(cPin, pin)) {
      if (c.status === "suspended") {
        return { ok: false, status: 402, error: "Akun dojang sedang dinonaktifkan sementara. Hubungi penyedia sistem Dojang HQ." };
      }
      if (c.expiresAt) {
        const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
        if (String(c.expiresAt) < today) {
          return { ok: false, status: 402, error: "Masa aktif langganan Dojang HQ telah berakhir pada " + c.expiresAt + ". Silakan perpanjang lisensi." };
        }
      }
      return { ok: true, role: "club", clubId: r.id, club: { id: r.id, ...c } };
    }
  }

  return fail(403, "Username atau PIN salah");
}

// ===== Penyimpanan data per klub =====
// Koleksi yang id-nya dibuat dari tanggal / nama (mis. absensi "2026-11-18", unit "utama") bisa sama di dua klub.
// Supaya tidak bentrok, id disimpan dengan awalan klub ("garuda@2026-11-18"). Aplikasi tetap memakai id biasa:
// awalan ditambah saat menyimpan dan dibuang saat membaca. Data lama (tanpa awalan) tetap terbaca.
export const NS = new Set(["attendance", "payments", "evaluations", "units", "coaches", "classes", "settings"]);
export const storeId = (clubId, coll, id) => (NS.has(coll) ? clubId + "@" + id : id);
export const logicalId = (coll, id) => {
  const s = String(id);
  return NS.has(coll) && s.includes("@") ? s.slice(s.indexOf("@") + 1) : s;
};
// Koleksi yang tidak boleh diubah lewat API umum (punya jalur khusus dan berisi kata sandi / catatan internal)
export const PROTECTED = new Set(["staff", "staff_rl", "clubs", "audit_log"]);

// Baca satu dokumen klub: versi berawalan dulu, lalu versi lama bila memang milik klub ini
export async function getDoc(env, clubId, coll, id) {
  const sid = storeId(clubId, coll, id);
  let row = await env.DB.prepare("SELECT data FROM docs WHERE coll=? AND id=?").bind(coll, sid).first();
  if (row) {
    const d = JSON.parse(row.data);
    return d.clubId && d.clubId !== clubId ? { foreign: true } : { data: d, legacy: false };
  }
  if (sid !== id) {
    row = await env.DB.prepare("SELECT data FROM docs WHERE coll=? AND id=?").bind(coll, id).first();
    if (row) {
      const d = JSON.parse(row.data);
      if (d.clubId === clubId) return { data: d, legacy: true };
    }
  }
  return null;
}
export async function putDoc(env, clubId, coll, id, obj) {
  const sid = storeId(clubId, coll, id);
  await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES(?,?,?)").bind(coll, sid, JSON.stringify({ ...obj, clubId })).run();
  if (sid !== id) {   // buang salinan lama milik klub ini supaya tidak dobel
    await env.DB.prepare("DELETE FROM docs WHERE coll=? AND id=? AND json_extract(data,'$.clubId')=?").bind(coll, id, clubId).run();
  }
}
export async function delDoc(env, clubId, coll, id) {
  const sid = storeId(clubId, coll, id);
  await env.DB.prepare("DELETE FROM docs WHERE coll=? AND id=?").bind(coll, sid).run();
  if (sid !== id) await env.DB.prepare("DELETE FROM docs WHERE coll=? AND id=? AND json_extract(data,'$.clubId')=?").bind(coll, id, clubId).run();
}
// Ambil semua dokumen satu koleksi (atau beberapa) milik klub, id sudah dibersihkan, versi berawalan menang atas versi lama
// colls = null → semua koleksi klub kecuali yang PROTECTED (satu query saja)
export async function clubRows(env, clubId, colls) {
  await ensureSchema(env);
  let rs;
  if (colls) {
    const ph = colls.map(() => "?").join(",");
    rs = await env.DB.prepare(`SELECT coll,id,data FROM docs WHERE json_extract(data,'$.clubId')=? AND coll IN (${ph})`).bind(clubId, ...colls).all();
  } else {
    rs = await env.DB.prepare("SELECT coll,id,data FROM docs WHERE json_extract(data,'$.clubId')=?").bind(clubId).all();
  }
  const map = new Map();
  for (const r of rs.results) {
    if (!colls && PROTECTED.has(r.coll)) continue;
    let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
    const id = logicalId(r.coll, r.id), k = r.coll + "\u0000" + id, pre = String(r.id).includes("@") && NS.has(r.coll);
    if (!map.has(k) || pre) map.set(k, { coll: r.coll, id, d });
  }
  return [...map.values()];
}
