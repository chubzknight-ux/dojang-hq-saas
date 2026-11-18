import { J, authenticate, clubRows } from "./_auth.js";
import { jsonEtag } from "./staff.js";

// GET /api/all — sinkron data admin klub / Super Admin.
// Dipanggil berkala oleh aplikasi; memakai ETag supaya bila data tidak berubah
// server cukup membalas 304 (tanpa isi) dan HP tidak mengunduh ulang semua data + logo.
export async function onRequestGet({ env, request }) {
  const auth = await authenticate(env, request);
  if (!auth.ok) return J({ error: auth.error }, auth.status);

  if (auth.role === "superadmin" && !auth.clubId) {
    const clubs = [];
    const counts = {};
    const rs = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='clubs'").all();
    for (const r of rs.results) {
      try { clubs.push({ id: r.id, ...JSON.parse(r.data) }); } catch (e) { /* lewati data rusak */ }
    }
    // hanya ambil dua field yang dibutuhkan, bukan seluruh isi data murid semua klub
    const st = await env.DB.prepare(
      "SELECT json_extract(data,'$.clubId') AS c, json_extract(data,'$.cuti') AS x FROM docs WHERE coll='students'"
    ).all();
    for (const r of st.results) if (r.c && !r.x) counts[r.c] = (counts[r.c] || 0) + 1;
    clubs.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), "id"));
    return jsonEtag(request, { role: "superadmin", clubs, counts });
  }

  // urutan tetap supaya ETag stabil bila data tidak berubah
  const rows = (await clubRows(env, auth.clubId, null)).sort((a, b) => (a.coll + "\u0000" + a.id).localeCompare(b.coll + "\u0000" + b.id));
  const out = {};
  for (const { coll, id, d } of rows) (out[coll] = out[coll] || []).push({ id, ...d });

  return jsonEtag(request, {
    role: auth.role,
    club: auth.club,
    data: out
  });
}
