import { J as _J, cleanSlug, clubRows, putDoc } from "./_auth.js";
import { userFromToken, ownerOf, cleanEvalDoc, jsonEtag, unitScope, scopeOf, audit, loadClub, clubInfo } from "./staff.js";

const J = _J;
const validId = id => /^[A-Za-z0-9_-]{1,120}$/.test(id);
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
const isCoachEval = (id, d) => (d && d.type === "coach_eval") || String(id).startsWith("coach_eval__");
const DEF_UNIT = "Utama";

// GET /api/coach?club=<kode-dojang>
// - Tanpa login (halaman orang tua, layar login): hanya info klub, profil pelatih, jadwal, dan ulasan orang tua.
//   Daftar murid dan nilai murid TIDAK dikirim.
// - Dengan token pelatih yang sah: data lengkap untuk Portal Pelatih (klub diambil dari akun pelatih).
export async function onRequestGet({ env, request }) {
  let user = null;
  if (request.headers.get("X-Dojang-Token")) {
    user = await userFromToken(request, env);
    if (!user) return J({ error: "unauthorized" }, 401);
  }

  let clubId = user ? user.clubId : cleanSlug(new URL(request.url).searchParams.get("club") || "");
  if (!clubId) {
    // belum tahu klub mana: kalau hanya ada satu klub aktif, pakai itu; kalau banyak, minta pilih
    const rs = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='clubs'").all();
    const clubs = rs.results.map(r => ({ id: r.id, ...JSON.parse(r.data) })).filter(c => c.status !== "suspended");
    if (clubs.length === 1) clubId = clubs[0].id;
    else return J({ needsClub: true, clubs: clubs.map(c => ({ id: c.id, name: c.name || c.id })) });
  }

  const c = user ? { club: user._club } : await loadClub(env, clubId);
  if (c.error) return J({ error: c.error }, c.status || 404);

  const rows = await clubRows(env, clubId, ["students", "evaluations", "classes", "coaches", "units"]);
  const scope = user ? unitScope(user, rows.filter(r => r.coll === "students").map(r => ({ id: r.id, data: r.d }))) : null;
  const uk = x => String(x == null ? "" : x).trim().toLowerCase();
  const students = [], evaluations = [], classes = [], coaches = [], units = [];

  for (const { coll, id, d } of rows) {
    if (coll === "students") {
      if (user && !d.cuti && (!scope || scope.ids.has(id))) students.push({ id, n: d.n, a: d.a, bi: d.bi, v: d.v, unit: d.unit || DEF_UNIT });
    } else if (coll === "evaluations") {
      if (user) {
        if (isCoachEval(id, d)) continue;
        if (scope) {
          const ev = {};
          for (const k of Object.keys(d.ev || {})) if (scope.ids.has(k)) ev[k] = d.ev[k];
          if (!Object.keys(ev).length) continue;
          d.ev = ev;
        }
        evaluations.push({ id, ...d });
      } else if (isCoachEval(id, d)) evaluations.push({ id, ...d });
    } else if (coll === "classes") {
      if (!scope || scope.units.has(uk(d.unit || DEF_UNIT))) classes.push({ id, unit: d.unit || DEF_UNIT, ...d });
    } else if (coll === "coaches") coaches.push({ id, ...d });
    else if (coll === "units") {
      if (!scope || scope.units.has(uk(d.name || id))) { const { fee, ...rest } = d; units.push({ id, ...(user ? rest : d) }); }
    }
  }

  const out = { club: await clubInfo(env, c.club), students, evaluations, classes, coaches, units };
  if (user) {
    out.user = { name: user.name, username: user.username, perm: { absen: !!(user.perm && user.perm.absen), nilai: !!(user.perm && user.perm.nilai) }, units: Array.isArray(user.units) ? user.units : [], mustChange: !!user.mustChange };
    return jsonEtag(request, out);
  }
  return J(out);
}

export async function onRequestPost({ env, request }) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return J({ error: "bad body" }, 400);

  // Mendaftarkan pelatih: hanya admin klub atau akun pelatih yang sudah login
  if (body.action === "register_coach") {
    let clubId = "";
    const user = request.headers.get("X-Dojang-Token") ? await userFromToken(request, env) : null;
    if (user) clubId = user.clubId;
    else {
      const own = await ownerOf(env, request);
      if (!own.ok) return J({ error: "unauthorized" }, 401);
      clubId = own.clubId;
    }
    const id = String(body.id || "").trim();
    const name = String(body.name || "").trim();
    if (!validId(id) || !name) return J({ error: "invalid coach" }, 400);
    await putDoc(env, clubId, "coaches", id, { name: clip(name, 120), updatedAt: new Date().toISOString() });
    return J({ ok: true });
  }

  if (body.action === "save_eval") {
    const id = String(body.id || "").trim();
    const d = body.data;
    if (!validId(id) || !d || typeof d !== "object" || Array.isArray(d)) return J({ error: "invalid eval" }, 400);
    if (JSON.stringify(d).length > 200000) return J({ error: "too large" }, 413);
    let clean, clubId, who = "", role = "pelatih", act = "penilaian";

    if (d.type === "coach_eval") {
      // ulasan orang tua untuk pelatih: tetap terbuka untuk orang tua (tanpa login), tapi harus menyebut klubnya
      if (!id.startsWith("coach_eval__")) return J({ error: "invalid eval id" }, 400);
      const c = await loadClub(env, body.clubId || body.club || "");
      if (c.error) return J({ error: c.error }, c.status || 404);
      clubId = c.club.id;
      const r = d.ratings && typeof d.ratings === "object" ? d.ratings : {};
      const rt = {};
      for (const k of ["m", "t", "k", "d", "w"]) { const v = Number(r[k]); rt[k] = v >= 1 && v <= 5 ? Math.round(v) : 5; }
      clean = { type: "coach_eval", coach: "", targetCoachId: clip(d.targetCoachId, 80), targetCoachName: clip(d.targetCoachName, 120), parentName: clip(d.parentName, 120), studentName: clip(d.studentName, 120), date: clip(d.date, 10), updatedAt: clip(d.updatedAt, 20), ratings: rt, comment: clip(d.comment, 1500) };
    } else {
      // penilaian murid: wajib login pelatih yang punya izin, hanya atas nama sendiri
      const user = await userFromToken(request, env);
      if (!user) return J({ error: "Silakan masuk dengan akun pelatih." }, 401);
      const r = cleanEvalDoc(user, id, d, await scopeOf(env, user));
      if (r.error) return J({ error: r.error }, r.status || 400);
      clean = r.clean; clubId = user.clubId; who = user.name;
      await audit(env, clubId, who, role, act, { id, n: Object.keys(clean.ev).length });
    }
    await putDoc(env, clubId, "evaluations", id, clean);
    return J({ ok: true });
  }

  return J({ error: "unknown action" }, 400);
}
