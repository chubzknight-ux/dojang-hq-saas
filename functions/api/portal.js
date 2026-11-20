import { J, clubRows, authenticate } from "./_auth.js";
import { clubInfo, hitLimit, ageOf, wibToday } from "./staff.js";

// ===== Pengaman Portal Orang Tua =====
// Orang tua membuka tautan lalu mengetik NAMA ANAK sekali per perangkat. Server lalu memberi token bertanda tangan
// (berlaku 180 hari) yang mencakup semua saudara kandung di klub yang sama, jadi nama salah satu anak sudah cukup.
// Tanpa token yang sah server tidak mengirim data apa pun dan tidak memberi tahu apakah ID murid itu ada.
// Hierarki: Super Admin dan Admin klub (login admin) boleh membuka portal tanpa nama anak, tetapi Admin klub hanya untuk muridnya sendiri.
const TOKEN_DAYS = 180;
const enc = new TextEncoder();
const b64u = u8 => { let s = ""; u8.forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const hmacKey = env => crypto.subtle.importKey("raw", enc.encode("dojang-portal-v1|" + String(env.TOKEN_SECRET || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
async function makeToken(env, ids, clubId) {
  const payload = b64u(enc.encode(JSON.stringify({ ids, c: clubId, exp: Date.now() + TOKEN_DAYS * 864e5 })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(payload)));
  return payload + "." + b64u(sig);
}
// Mengembalikan daftar id murid (huruf kecil) yang boleh dibuka token ini, atau null bila token tidak sah
export async function tokenIds(env, tok) {
  const i = String(tok || "").indexOf(".");
  if (i < 1 || !env.TOKEN_SECRET) return null;
  try {
    const payload = tok.slice(0, i);
    if (!(await crypto.subtle.verify("HMAC", await hmacKey(env), fromB64u(tok.slice(i + 1)), enc.encode(payload)))) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64u(payload)));
    if (!p.exp || p.exp < Date.now() || !Array.isArray(p.ids)) return null;
    return p.ids.map(x => String(x).toLowerCase());
  } catch (e) { return null; }
}
// Nama dicocokkan tanpa membedakan huruf besar/kecil, tanda baca, dan spasi.
// Diterima: nama lengkap, atau salah satu kata dari nama (minimal 3 huruf), kecuali kata umum seperti "Muhammad".
const COMMON = new Set(["muhammad", "muhamad", "mohammad", "mohamad", "mochammad", "mochamad", "muhammed", "moh", "muh", "mhd"]);
const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function nameMatches(typed, fullName) {
  const t = norm(typed), f = norm(fullName);
  if (!t || !f) return false;
  if (t === f) return true;
  if (t.includes(" ") || t.length < 3 || COMMON.has(t)) return false;
  return f.split(" ").includes(t);
}
const NEED = () => Response.json({ error: "verify", need: "name" }, { status: 401, headers: { "Cache-Control": "no-store" } });
const cleanWaP = s => String(s || "").replace(/\D/g, "").replace(/^0/, "62");
const famKey = st => {
  const w = cleanWaP(st && st.wa);
  if (w.length >= 9) return "wa:" + w;
  const o = String((st && st.ortu) || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return o.length >= 3 ? "ortu:" + o : "";
};
async function findStudent(env, rawId) {
  let row = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='students' AND id=?").bind(rawId).first();
  if (!row) row = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='students' AND lower(id)=lower(?)").bind(rawId).first();
  if (!row) return null;
  try { return { id: row.id, ...JSON.parse(row.data) }; } catch (e) { return null; }
}
async function clubOf(env, clubId) {
  const clubRow = clubId ? await env.DB.prepare("SELECT id, data FROM docs WHERE coll='clubs' AND id=?").bind(clubId).first() : null;
  const club = clubRow ? { id: clubRow.id, ...JSON.parse(clubRow.data) } : { id: clubId || "default", name: "Dojang HQ", headCoach: "Kepala Pelatih", logo: "" };
  let blocked = false;
  if (club.status === "suspended") blocked = true;
  if (club.expiresAt && String(club.expiresAt) < new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)) blocked = true;
  return { club, blocked };
}

// POST /api/portal {action:"verify", id, name} → {ok, token, ids}
export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body || body.action !== "verify") return Response.json({ error: "bad request" }, { status: 400 });
  if (!env.TOKEN_SECRET) return Response.json({ error: "Server belum diatur." }, { status: 500 });
  if (!(await hitLimit(env, request, "pv", 10, 15 * 60000)))
    return Response.json({ error: "Terlalu banyak percobaan. Coba lagi 15 menit lagi." }, { status: 429 });
  const id = String(body.id || "").trim().replace(/^\/+|\/+$/g, "").slice(0, 120);
  const typed = String(body.name || "").slice(0, 120);
  const WRONG = Response.json({ error: "Nama anak tidak cocok. Periksa ejaannya lalu coba lagi." }, { status: 403 });
  const st = id ? await findStudent(env, id) : null;
  if (!st || !st.clubId) return WRONG;
  // batas tambahan per murid (menahan tebakan dari banyak jaringan sekaligus)
  if (!(await hitLimit(env, request, "pvs", 30, 60 * 60000, String(st.id))))
    return Response.json({ error: "Terlalu banyak percobaan untuk murid ini. Coba lagi nanti." }, { status: 429 });
  const students = (await clubRows(env, st.clubId, ["students"])).map(r => ({ id: r.id, ...r.d }));
  const fk = famKey(st);
  const family = fk ? students.filter(s => s.id === st.id || famKey(s) === fk) : [st];
  // body.self: akses murid langsung (Champion) — nama harus cocok dengan murid itu sendiri, token hanya untuk dia (tanpa saudara)
  const self = body.self === true;
  if (!(self ? nameMatches(typed, st.n) : family.some(s => nameMatches(typed, s.n)))) return WRONG;
  const { blocked } = await clubOf(env, st.clubId);
  if (blocked) return Response.json({ error: "Portal dojang ini sedang tidak aktif." }, { status: 402 });
  return Response.json({ ok: true, token: await makeToken(env, (self ? [st] : family).map(s => String(s.id)), st.clubId), ids: (self ? [st] : family).map(s => String(s.id)) }, { headers: { "Cache-Control": "no-store" } });
}

// Portal orang tua: GET /api/portal?id=<id murid>
// Id murid dipakai untuk menemukan klubnya; semua data yang dikirim hanya dari klub itu.
export async function onRequestGet({ request, env }) {
  const rawId = String(new URL(request.url).searchParams.get("id") || "").trim().replace(/^\/+|\/+$/g, "");
  if (!rawId) return J({ error: "id required" }, 400);

  const cleanWa = s => String(s || "").replace(/\D/g, "").replace(/^0/, "62");
  const fKey = st => {
    const w = cleanWa(st && st.wa);
    if (w.length >= 9) return "wa:" + w;
    const o = String((st && st.ortu) || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (o.length >= 3) return "ortu:" + o;
    return "";
  };

  // Admin yang sudah masuk boleh langsung (Admin klub hanya untuk klubnya); selain itu wajib token hasil verifikasi nama anak.
  // Jawabannya sama untuk ID yang ada maupun tidak, supaya ID tidak bisa ditebak.
  const isAdminReq = request.headers.get("X-Dojang-Admin-Token") || request.headers.get("X-Dojang-Pin");
  let adminAuth = null;
  if (isAdminReq) {
    adminAuth = await authenticate(env, request);
    if (!adminAuth.ok) return J({ error: adminAuth.error }, adminAuth.status);
  } else {
    const ids = await tokenIds(env, request.headers.get("X-Portal-Token"));
    if (!ids || !ids.includes(rawId.toLowerCase())) return NEED();
  }

  const st = await findStudent(env, rawId);
  if (!st) return adminAuth ? J({ error: "not found" }, 404) : NEED();
  const clubId = st.clubId || "";
  if (adminAuth && adminAuth.role !== "superadmin" && adminAuth.clubId !== clubId) return J({ error: "forbidden" }, 403);

  const clubRow = clubId ? await env.DB.prepare("SELECT id, data FROM docs WHERE coll='clubs' AND id=?").bind(clubId).first() : null;
  const club = clubRow ? { id: clubRow.id, ...JSON.parse(clubRow.data) } : { id: clubId || "default", name: "Dojang HQ", headCoach: "Kepala Pelatih", logo: "" };
  if (club.status === "suspended") return J({ error: "Portal dojang ini sedang tidak aktif." }, 402);
  if (club.expiresAt) {
    const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    if (String(club.expiresAt) < today) return J({ error: "Portal dojang ini sedang tidak aktif." }, 402);
  }

  const rows = await clubRows(env, clubId, ["students", "attendance", "payments", "evaluations", "classes", "pengumuman"]);
  const by = c => rows.filter(r => r.coll === c).map(r => ({ id: r.id, ...r.d }));
  const students = by("students"), attendance = by("attendance"), payments = by("payments"), evaluations = by("evaluations"), classes = by("classes"), pengumuman = by("pengumuman");

  const sid = String(st.id).trim();
  const sidLow = sid.toLowerCase();
  const hasId = ids => {
    if (!ids) return false;
    if (Array.isArray(ids)) return ids.some(x => String(x || "").trim().toLowerCase() === sidLow);
    if (typeof ids === "object") return Object.entries(ids).some(([k, v]) => Boolean(v) && String(k || "").trim().toLowerCase() === sidLow);
    return false;
  };

  // riwayat iuran per bulan (gabungan catatan bulanan dan daftar bulan lunas di data murid)
  const payMap = new Map();
  payments.forEach(p => {
    const ym = String(p.month || p.id || "").trim().slice(0, 7);
    if (!ym) return;
    payMap.set(ym, Boolean(payMap.get(ym)) || hasId(p.ids));
  });
  if (Array.isArray(st.paidMonths)) {
    st.paidMonths.forEach(m => { const ym = String(m || "").trim().slice(0, 7); if (ym) payMap.set(ym, true); });
  }
  const normalizedPayments = [...payMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ym, lunas]) => ({ id: ym, month: ym, lunas }));

  const fk = fKey(st);
  const siblings = fk
    ? students.filter(s => s.id !== st.id && !s.cuti && fKey(s) === fk).map(s => ({ id: s.id, n: s.n, unit: s.unit || "Utama" }))
    : [];

  // hanya data yang ditampilkan di portal orang tua (tanpa nomor WA & data internal lain)
  const SHOW = ["id", "n", "a", "bi", "v", "unit", "gender", "ortu", "fee", "cuti", "cutiKet", "cutiTgl", "sejak", "sk", "siap", "pct", "note", "sabukHist"];
  const student = {};
  for (const k of SHOW) if (st[k] !== undefined) student[k] = st[k];
  if (st.lahir) student.a = ageOf(st.lahir, st.a);      // usia ikut bertambah tiap tahun (tanggal lahir sendiri tidak dikirim)
  return new Response(JSON.stringify({
    club: await clubInfo(env, club),
    student,
    siblings,
    attendance: attendance.map(a => ({ id: a.id, hadir: hasId(a.ids) })),
    payments: normalizedPayments,
    evaluations: evaluations
      .filter(e => e.ev && (e.ev[sid] || e.ev[st.id]) && !(e.type === "coach_eval"))
      .map(e => ({ id: e.id, date: e.date || String(e.id || "").slice(0, 10), coach: e.coach || "Pelatih", ...(e.ev[sid] || e.ev[st.id]) })),
    classes: classes.map(({ clubId: _x, ...c }) => c),
    // pengumuman yang sedang berlaku untuk semua unit atau unit anak ini
    announcements: (() => {
      const t = wibToday(), u = String(st.unit || "Utama").trim().toLowerCase();
      return pengumuman
        .filter(a => String(a.mulai || "") <= t && String(a.sampai || "") >= t && (!a.unit || String(a.unit).trim().toLowerCase() === u))
        .sort((a, b) => String(b.mulai || "").localeCompare(String(a.mulai || "")))
        .map(a => ({ judul: String(a.judul || "").slice(0, 120), isi: String(a.isi || "").slice(0, 1500), unit: String(a.unit || "").slice(0, 40), mulai: a.mulai, sampai: a.sampai }));
    })()
  }), {
    headers: { "content-type": "application/json", "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", "Pragma": "no-cache", "Expires": "0" }
  });
}
