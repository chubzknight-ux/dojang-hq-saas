import { J, authenticate, clubRows, PROTECTED } from "./_auth.js";

export async function onRequestGet({ env, request }) {
  const auth = await authenticate(env, request);
  if (!auth.ok) return J({ error: auth.error }, auth.status);

  if (auth.role === "superadmin" && !auth.clubId) {
    const clubs = [];
    const counts = {};
    const rs = await env.DB.prepare("SELECT coll, id, data FROM docs WHERE coll IN ('clubs','students')").all();
    for (const r of rs.results) {
      const d = JSON.parse(r.data);
      if (r.coll === "clubs") {
        clubs.push({ id: r.id, ...d });
      } else if (r.coll === "students" && d.clubId && !d.cuti) {
        counts[d.clubId] = (counts[d.clubId] || 0) + 1;
      }
    }
    clubs.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), "id"));
    return J({ role: "superadmin", clubs, counts });
  }

  const colls = ["students", "attendance", "payments", "evaluations", "units", "classes", "coaches", "settings"];
  const out = {};
  const rs2 = await env.DB.prepare("SELECT DISTINCT coll FROM docs WHERE json_extract(data,'$.clubId')=?").bind(auth.clubId).all();
  for (const r of rs2.results) if (!PROTECTED.has(r.coll) && !colls.includes(r.coll)) colls.push(r.coll);
  for (const { coll, id, d } of await clubRows(env, auth.clubId, colls)) {
    (out[coll] = out[coll] || []).push({ id, ...d });
  }

  return J({
    role: auth.role,
    club: auth.club,
    data: out
  });
}