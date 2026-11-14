import { J, cleanSlug } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const rawId = String(url.searchParams.get("id") || "").trim().replace(/^\/+|\/+$/g, "");
  if (!rawId) return J({ error: "id required" }, 400);

  const cleanWa = s => String(s || "").replace(/\D/g, "").replace(/^0/, "62");
  const fKey = st => {
    const w = cleanWa(st && st.wa);
    if (w.length >= 9) return "wa:" + w;
    const o = String((st && st.ortu) || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (o.length >= 3) return "ortu:" + o;
    return "";
  };

  const rs = await env.DB.prepare("SELECT coll, id, data FROM docs").all();
  const byColl = { clubs: [], students: [], attendance: [], payments: [], evaluations: [], classes: [] };
  for (const r of rs.results) {
    if (byColl[r.coll]) byColl[r.coll].push({ id: r.id, ...JSON.parse(r.data) });
  }

  const lowId = rawId.toLowerCase();
  const st = byColl.students.find(s => s.id === rawId) ||
             byColl.students.find(s => String(s.id || "").toLowerCase() === lowId);
  if (!st) return J({ error: "not found" }, 404);

  const clubId = st.clubId || "";
  const club = byColl.clubs.find(c => c.id === clubId) || {
    id: clubId || "default",
    name: "Dojang HQ",
    headCoach: "Kepala Pelatih",
    logo: ""
  };

  const sameClub = arr => arr.filter(x => (x.clubId || "") === clubId);
  const cStudents = sameClub(byColl.students);
  const cAtt = sameClub(byColl.attendance);
  const cPay = sameClub(byColl.payments);
  const cEval = sameClub(byColl.evaluations);
  const cClass = sameClub(byColl.classes);

  const fk = fKey(st);
  const siblings = fk
    ? cStudents.filter(s => s.id !== st.id && !s.cuti && fKey(s) === fk).map(s => ({ id: s.id, n: s.n, unit: s.unit || "Utama" }))
    : [];

  return J({
    club: {
      id: club.id,
      name: club.name || "Dojang HQ",
      headCoach: club.headCoach || "Kepala Pelatih",
      logo: club.logo || ""
    },
    student: st,
    siblings,
    attendance: cAtt.map(a => ({ id: a.id, hadir: !!(a.ids && a.ids[st.id]) })),
    payments: cPay.map(p => ({ id: p.id, lunas: !!(p.ids && p.ids[st.id]) })),
    evaluations: cEval
      .filter(e => e.ev && e.ev[st.id])
      .map(e => ({ id: e.id, date: e.date || e.id.slice(0, 10), coach: e.coach || "Pelatih", ...e.ev[st.id] })),
    classes: cClass
  });
}