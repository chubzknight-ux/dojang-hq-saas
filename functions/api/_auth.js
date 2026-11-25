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

// ===== Pembatas percobaan (atomik) =====
// Satu pernyataan SQL menaikkan hitungan sekaligus mengembalikan nilainya, jadi permintaan paralel dari satu IP
// tidak bisa lolos bersamaan (pola "baca lalu tulis" lama bisa dilewati dengan banyak permintaan sekaligus).
// Mengembalikan jumlah percobaan dalam jendela waktu ini (termasuk yang sekarang).
export async function rlBump(env, id, winMs) {
  const now = Date.now();
  const r = await env.DB.prepare(
    "INSERT INTO docs(coll,id,data) VALUES('staff_rl',?1,json_object('n',1,'t',?2)) " +
    "ON CONFLICT(coll,id) DO UPDATE SET data = CASE " +
    "WHEN ?2 - coalesce(json_extract(docs.data,'$.t'),0) >= ?3 THEN json_object('n',1,'t',?2) " +
    "ELSE json_set(docs.data,'$.n', coalesce(json_extract(docs.data,'$.n'),0)+1) END " +
    "RETURNING json_extract(data,'$.n') AS n"
  ).bind(id, now, winMs).first();
  return r ? Number(r.n) : 1;
}
export const rlClear = (env, id) => env.DB.prepare("DELETE FROM docs WHERE coll='staff_rl' AND id=?").bind(id).run();

// ===== PIN admin: hash + token =====
// PIN admin klub disimpan sebagai hash PBKDF2 ("p1$salt$hash"), bukan teks asli. PIN lama (teks) otomatis di-hash saat admin berhasil masuk.
// Setelah masuk, aplikasi memakai token bertanda tangan (X-Dojang-Admin-Token) sehingga PIN tidak disimpan di HP dan tidak dikirim di tiap permintaan.
const enc = new TextEncoder();
const b64 = u8 => { let s = ""; u8.forEach(b => (s += String.fromCharCode(b))); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64u = u8 => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
const eq = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const ADMIN_ITER = 100000; // batas maksimum PBKDF2 di Cloudflare Workers
const ADMIN_TOKEN_MS = { club: 7 * 864e5, superadmin: 12 * 36e5 };

async function pbkdf2(pin, salt) {
  const k = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ADMIN_ITER }, k, 256));
}
export async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return "p1$" + b64(salt) + "$" + b64(await pbkdf2(String(pin), salt));
}
async function verifyPin(stored, pin) {
  const [v, salt, hash] = String(stored).split("$");
  if (v !== "p1" || !salt || !hash) return false;
  return eq(b64(await pbkdf2(String(pin), unb64(salt))), hash);
}
const sha10 = async s => b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))).slice(0, 10);
const hmacKey = env => crypto.subtle.importKey("raw", enc.encode(String(env.TOKEN_SECRET)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
// Versi PIN di dalam token: bila PIN diganti, token lama otomatis tidak berlaku
const clubPv = c => sha10("c|" + (c.adminPinHash || c.adminPin || ""));
const saPv = env => sha10("s|" + String(env.SUPERADMIN_PIN || env.DOJANG_PIN || ""));

export async function makeAdminToken(env, role, user, clubId, pv) {
  const payload = b64u(enc.encode(JSON.stringify({ r: role, u: user, c: clubId || "", pv, ex: Date.now() + ADMIN_TOKEN_MS[role] })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(payload)));
  return payload + "." + b64u(sig);
}
// Data klub yang aman dikirim ke aplikasi: tanpa PIN / hash PIN
export const stripSecrets = c => { if (!c) return c; const { adminPin, adminPinHash, ...rest } = c; return rest; };

// Klub tidak aktif (ditangguhkan / kedaluwarsa)? Kembalikan pesan galat, atau null bila aktif.
function clubBlocked(c) {
  if (c.status === "suspended") return "Akun dojang sedang dinonaktifkan sementara. Hubungi penyedia sistem Dojang HQ.";
  if (c.expiresAt) {
    const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    if (String(c.expiresAt) < today) return "Masa aktif langganan Dojang HQ telah berakhir pada " + c.expiresAt + ". Silakan perpanjang lisensi.";
  }
  return null;
}

async function superadminCtx(env, targetClub) {
  let club = null;
  if (targetClub) {
    const row = await env.DB.prepare("SELECT id, data FROM docs WHERE coll = 'clubs' AND id = ?").bind(targetClub).first();
    if (row) club = { id: row.id, ...JSON.parse(row.data) };
  }
  return { ok: true, role: "superadmin", clubId: club ? club.id : null, club: stripSecrets(club) };
}

// Masuk dengan token admin
async function tokenAuth(env, token, targetClub) {
  const expired = { ok: false, status: 401, error: "Sesi berakhir. Silakan masuk lagi." };
  const i = token.indexOf(".");
  if (i < 1 || !env.TOKEN_SECRET) return expired;
  try {
    const payload = token.slice(0, i);
    if (!(await crypto.subtle.verify("HMAC", await hmacKey(env), unb64u(token.slice(i + 1)), enc.encode(payload)))) return expired;
    const p = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    if (!p.ex || p.ex < Date.now()) return expired;
    if (p.r === "superadmin") {
      const saPin = String(env.SUPERADMIN_PIN || env.DOJANG_PIN || "").trim();
      if (!saPin || p.pv !== (await saPv(env))) return expired;
      return superadminCtx(env, targetClub);
    }
    const row = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='clubs' AND id=?").bind(p.c).first();
    if (!row) return expired;
    const c = JSON.parse(row.data);
    if (p.pv !== (await clubPv(c))) return expired;
    const blocked = clubBlocked(c);
    if (blocked) return { ok: false, status: 402, error: blocked, payClub: row.id };
    return { ok: true, role: "club", clubId: row.id, club: { id: row.id, ...stripSecrets(c) } };
  } catch (e) { return expired; }
}

// Masuk dengan username + PIN (dibatasi 10x salah / 15 menit per IP). Mengembalikan juga info untuk membuat token.
export async function passwordAuth(env, req, user, pin, targetClub) {
  const saUser = String(env.SUPERADMIN_USER || "superadmin").trim().toLowerCase();
  // Tidak ada PIN bawaan: Super Admin baru aktif setelah SUPERADMIN_PIN diisi di Cloudflare (disarankan kalimat sandi panjang)
  const saPin = String(env.SUPERADMIN_PIN || env.DOJANG_PIN || "").trim();

  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const rlKey = "adm:" + ip;
  const RL_WIN = 15 * 60000, RL_MAX = 10;
  // Setiap percobaan dihitung DULU secara atomik (10x / 15 menit / IP); berhasil masuk = hitungan dihapus.
  // Permintaan tanpa user/PIN (token) tidak dihitung.
  if (user && pin && (await rlBump(env, rlKey, RL_WIN)) > RL_MAX) {
    return { ok: false, status: 429, error: "Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi." };
  }
  const fail = async (status, error) => ({ ok: false, status, error });
  const okRl = async () => { if (user && pin) await rlClear(env, rlKey); };

  if (user && pin && saPin && user === saUser && eq(pin, saPin)) {
    await okRl();
    return { ...(await superadminCtx(env, targetClub)), tokenInfo: { role: "superadmin", user: saUser, clubId: "", pv: await saPv(env) } };
  }

  if (!user || !pin) return { ok: false, status: 403, error: "Username atau PIN kosong" };

  const rs = await env.DB.prepare(
    "SELECT id, data FROM docs WHERE coll = 'clubs' AND lower(trim(coalesce(nullif(json_extract(data,'$.adminUser'),''), id))) = ?"
  ).bind(user).all();
  for (const r of rs.results) {
    let c = JSON.parse(r.data);
    const cUser = String(c.adminUser || r.id || "").trim().toLowerCase();
    if (cUser !== user) continue;
    let good = false;
    if (c.adminPinHash) good = await verifyPin(c.adminPinHash, pin);
    else if (c.adminPin && eq(String(c.adminPin).trim(), pin)) {
      good = true;
      // PIN lama masih teks: ubah jadi hash sekarang
      const { adminPin, ...rest } = c;
      c = { ...rest, adminPinHash: await hashPin(pin) };
      await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('clubs',?,?)").bind(r.id, JSON.stringify(c)).run();
    }
    if (!good) continue;
    const blocked = clubBlocked(c);
    if (blocked) return { ok: false, status: 402, error: blocked, payClub: r.id };
    await okRl();
    return { ok: true, role: "club", clubId: r.id, club: { id: r.id, ...stripSecrets(c) }, tokenInfo: { role: "club", user: cUser, clubId: r.id, pv: await clubPv(c) } };
  }

  return fail(403, "Username atau PIN salah");
}

export async function authenticate(env, req) {
  await ensureSchema(env);
  const targetClub = cleanSlug(req.headers.get("X-Target-Club") || "");
  const token = String(req.headers.get("X-Dojang-Admin-Token") || "").trim();
  if (token) return tokenAuth(env, token, targetClub);
  // Jalur lama (header username + PIN di setiap permintaan) tetap didukung supaya aplikasi versi lama di HP tidak langsung putus.
  // Setelah semua HP memakai versi baru, isi DISABLE_LEGACY_AUTH=1 di Cloudflare untuk mematikannya (PIN tidak lagi dikirim berulang).
  if (String(env.DISABLE_LEGACY_AUTH || "") === "1") return { ok: false, status: 401, error: "Sesi berakhir. Silakan masuk lagi." };
  const user = String(req.headers.get("X-Dojang-User") || "").trim().toLowerCase();
  const pin = String(req.headers.get("X-Dojang-Pin") || "").trim();
  return passwordAuth(env, req, user, pin, targetClub);
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
export const PROTECTED = new Set(["staff", "staff_rl", "clubs", "audit_log", "champion", "champion_foto", "champion_pr", "invoices", "billing_settings", "ai_usage", "techlog", "pose_cfg"]);

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
// Simpan satu dokumen. Atomik dan terkunci per klub: bila id yang sama (koleksi tanpa awalan klub, mis. murid) sudah dimiliki
// klub lain, penulisan DITOLAK oleh database itu sendiri, jadi tidak ada celah balapan antara cek dan tulis. Mengembalikan true bila tersimpan.
export async function putDoc(env, clubId, coll, id, obj) {
  const sid = storeId(clubId, coll, id);
  const r = await env.DB.prepare(
    "INSERT INTO docs(coll,id,data) VALUES(?1,?2,?3) ON CONFLICT(coll,id) DO UPDATE SET data=excluded.data " +
    "WHERE coalesce(json_extract(docs.data,'$.clubId'),'')='' OR json_extract(docs.data,'$.clubId')=?4"
  ).bind(coll, sid, JSON.stringify({ ...obj, clubId }), clubId).run();
  if (r && r.meta && r.meta.changes === 0) return false;
  if (sid !== id) {   // buang salinan lama milik klub ini supaya tidak dobel
    await env.DB.prepare("DELETE FROM docs WHERE coll=? AND id=? AND json_extract(data,'$.clubId')=?").bind(coll, id, clubId).run();
  }
  return true;
}
export async function delDoc(env, clubId, coll, id) {
  const sid = storeId(clubId, coll, id);
  await env.DB.prepare("DELETE FROM docs WHERE coll=? AND id=? AND (coalesce(json_extract(data,'$.clubId'),'')='' OR json_extract(data,'$.clubId')=?)").bind(coll, sid, clubId).run();
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
    // koleksi PROTECTED (termasuk hasil & foto Champion) tidak ikut dibaca, supaya sinkron tetap ringan
    const skip = [...PROTECTED];
    rs = await env.DB.prepare(`SELECT coll,id,data FROM docs WHERE json_extract(data,'$.clubId')=? AND coll NOT IN (${skip.map(() => "?").join(",")})`).bind(clubId, ...skip).all();
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
