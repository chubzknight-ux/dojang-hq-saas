import { J, clubRows } from "./_auth.js";
import { clubInfo } from "./staff.js";

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

  // cari murid (id persis dulu, lalu tanpa beda huruf besar/kecil)
  let row = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='students' AND id=?").bind(rawId).first();
  if (!row) row = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='students' AND lower(id)=lower(?)").bind(rawId).first();
  if (!row) return J({ error: "not found" }, 404);

  const st = { id: row.id, ...JSON.parse(row.data) };
  const clubId = st.clubId || "";

  const clubRow = clubId ? await env.DB.prepare("SELECT id, data FROM docs WHERE coll='clubs' AND id=?").bind(clubId).first() : null;
  const club = clubRow ? { id: clubRow.id, ...JSON.parse(clubRow.data) } : { id: clubId || "default", name: "Dojang HQ", headCoach: "Kepala Pelatih", logo: "" };
  if (club.status === "suspended") return J({ error: "Portal dojang ini sedang tidak aktif." }, 402);
  if (club.expiresAt) {
    const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    if (String(club.expiresAt) < today) return J({ error: "Portal dojang ini sedang tidak aktif." }, 402);
  }

  const rows = await clubRows(env, clubId, ["students", "attendance", "payments", "evaluations", "classes"]);
  const by = c => rows.filter(r => r.coll === c).map(r => ({ id: r.id, ...r.d }));
  const students = by("students"), attendance = by("attendance"), payments = by("payments"), evaluations = by("evaluations"), classes = by("classes");

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

  const { clubId: _c, ...student } = st;
  return new Response(JSON.stringify({
    club: await clubInfo(env, club),
    student,
    siblings,
    attendance: attendance.map(a => ({ id: a.id, hadir: hasId(a.ids) })),
    payments: normalizedPayments,
    evaluations: evaluations
      .filter(e => e.ev && (e.ev[sid] || e.ev[st.id]) && !(e.type === "coach_eval"))
      .map(e => ({ id: e.id, date: e.date || String(e.id || "").slice(0, 10), coach: e.coach || "Pelatih", ...(e.ev[sid] || e.ev[st.id]) })),
    classes: classes.map(({ clubId: _x, ...c }) => c)
  }), {
    headers: { "content-type": "application/json", "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", "Pragma": "no-cache", "Expires": "0" }
  });
}
