import { J, authenticate } from "./_auth.js";

export async function onRequestGet({ env, request }) {
  const auth = await authenticate(env, request);
  if (!auth.ok) return J({ error: auth.error }, auth.status);

  const rs = await env.DB.prepare("SELECT coll, id, data FROM docs").all();

  if (auth.role === "superadmin" && !auth.clubId) {
    const clubs = [];
    const counts = {};
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

  const out = {};
  for (const r of rs.results) {
    if (r.coll === "clubs") continue;
    const d = JSON.parse(r.data);
    if (d.clubId !== auth.clubId) continue;
    (out[r.coll] = out[r.coll] || []).push({ id: r.id, ...d });
  }

  return J({
    role: auth.role,
    club: auth.club,
    data: out
  });
}