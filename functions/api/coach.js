import { J, cleanSlug } from "./_auth.js";

const validId = id => /^[A-Za-z0-9_-]{1,80}$/.test(id);

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const clubParam = cleanSlug(url.searchParams.get("club") || "");

  const rs = await env.DB.prepare("SELECT coll, id, data FROM docs WHERE coll IN ('clubs','students','evaluations','classes','coaches','units')").all();
  const clubs = [];
  const allRows = [];
  for (const r of rs.results) {
    const d = JSON.parse(r.data);
    if (r.coll === "clubs") clubs.push({ id: r.id, ...d });
    else allRows.push({ coll: r.coll, id: r.id, ...d });
  }

  const targetClub = clubs.find(c => c.id === clubParam) || (clubs.length === 1 ? clubs[0] : null);
  if (!targetClub) {
    return J({
      needsClub: true,
      clubs: clubs.map(c => ({ id: c.id, name: c.name || c.id, logo: c.logo || "" }))
    });
  }

  const cid = targetClub.id;
  const students = [], evaluations = [], classes = [], coaches = [], units = [];
  for (const r of allRows) {
    if ((r.clubId || "") !== cid) continue;
    if (r.coll === "students" && !r.cuti) students.push({ id: r.id, n: r.n, a: r.a, bi: r.bi, v: r.v, unit: r.unit || "Utama" });
    else if (r.coll === "evaluations") evaluations.push(r);
    else if (r.coll === "classes") classes.push({ unit: r.unit || "Utama", ...r });
    else if (r.coll === "coaches") coaches.push(r);
    else if (r.coll === "units") units.push(r);
  }

  return J({
    club: {
      id: targetClub.id,
      name: targetClub.name || targetClub.id,
      headCoach: targetClub.headCoach || "Kepala Pelatih",
      logo: targetClub.logo || ""
    },
    students,
    evaluations,
    classes,
    coaches,
    units
  });
}

export async function onRequestPost({ env, request }) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return J({ error: "bad body" }, 400);

  const clubId = cleanSlug(body.clubId || "");
  if (!clubId) return J({ error: "clubId required" }, 400);

  const clubRow = await env.DB.prepare("SELECT id FROM docs WHERE coll = 'clubs' AND id = ?").bind(clubId).first();
  if (!clubRow) return J({ error: "club not found" }, 404);

  if (body.action === "register_coach") {
    const id = String(body.id || "").trim();
    const name = String(body.name || "").trim();
    if (!validId(id) || !name) return J({ error: "invalid coach" }, 400);
    await env.DB.prepare("INSERT OR REPLACE INTO docs(coll, id, data) VALUES('coaches', ?, ?)")
      .bind(id, JSON.stringify({ clubId, name, updatedAt: new Date().toISOString() }))
      .run();
    return J({ ok: true });
  }

  if (body.action === "save_eval") {
    const id = String(body.id || "").trim();
    if (!validId(id) || !body.data || typeof body.data !== "object") return J({ error: "invalid eval" }, 400);
    const payload = { ...body.data, clubId };
    await env.DB.prepare("INSERT OR REPLACE INTO docs(coll, id, data) VALUES('evaluations', ?, ?)")
      .bind(id, JSON.stringify(payload))
      .run();
    return J({ ok: true });
  }

  return J({ error: "unknown action" }, 400);
}