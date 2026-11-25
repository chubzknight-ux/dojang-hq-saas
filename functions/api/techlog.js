import { J, authenticate } from "./_auth.js";
import { userFromToken, hitLimit } from "./staff.js";

// Log teknis Analisa Video + penyetelan otomatis ambang penyaring pose.
// - Aplikasi mengirim log tiap analisa (angka titik tubuh tanpa gambar/nama, penyebab gagal, error aplikasi).
// - Super Admin menekan "Pelajari & setel otomatis": aplikasi menguji ulang log dengan berbagai ambang,
//   lalu menyimpan ambang terbaik di sini (berlaku untuk semua klien) dan log yang sudah dipakai dihapus.
// - Log otomatis dihapus setelah 60 hari.
const KEEP_MS = 60 * 864e5;
const MAX_BODY = 120 * 1024;
const MAX_LOGS = 400;
// Batas aman penyetelan (sama dengan PG_BOUNDS di index.html). Di luar batas ini penyaring bisa meloloskan kerangka di benda.
export const BOUNDS = {
  meanV: [0.5, 0.65], meanVBack: [0.45, 0.55], coreV: [0.4, 0.55], legV: [0.4, 0.55],
  minTorsoH: [0.04, 0.07], minBodyH: [0.15, 0.22], confN: [6, 10]
};
export const clampCfg = pg => {
  const o = {};
  for (const k of Object.keys(BOUNDS)) {
    let v = Number(pg && pg[k]);
    if (!Number.isFinite(v)) continue;
    if (k === "confN") v = Math.round(v);
    o[k] = Math.min(BOUNDS[k][1], Math.max(BOUNDS[k][0], v));
  }
  return o;
};

async function who(env, request) {
  if (request.headers.get("X-Dojang-Token")) {
    const u = await userFromToken(request, env);
    return u ? { role: "coach", clubId: u.clubId } : null;
  }
  const a = await authenticate(env, request);
  return a.ok ? { role: a.role, clubId: a.clubId || "" } : null;
}
const readCfg = async env => {
  const r = await env.DB.prepare("SELECT data FROM docs WHERE coll='pose_cfg' AND id='current'").first();
  return r ? JSON.parse(r.data) : { pg: {}, ver: 0, at: 0 };
};
async function sweep(env) {
  await env.DB.prepare("DELETE FROM docs WHERE coll='techlog' AND json_extract(data,'$.t') < ?").bind(Date.now() - KEEP_MS).run();
  await env.DB.prepare(
    "DELETE FROM docs WHERE coll='techlog' AND id IN (SELECT id FROM docs WHERE coll='techlog' ORDER BY json_extract(data,'$.t') DESC LIMIT -1 OFFSET ?)"
  ).bind(MAX_LOGS).run();
}

// GET /api/techlog?cfg=1 → ambang aktif (tanpa login: hanya angka ambang)
// GET /api/techlog       → Super Admin: semua log + setelan + riwayat
export async function onRequestGet({ env, request }) {
  const u = new URL(request.url);
  if (u.searchParams.get("cfg")) return J(await readCfg(env));
  const w = await who(env, request);
  if (!w || w.role !== "superadmin") return J({ error: "Hanya Super Admin" }, 403);
  await sweep(env);
  const rs = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='techlog' ORDER BY json_extract(data,'$.t') DESC").all();
  const hs = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='pose_cfg' AND id LIKE 'h\\_%' ESCAPE '\\' ORDER BY id DESC LIMIT 20").all();
  return J({
    logs: rs.results.map(r => ({ id: r.id, ...JSON.parse(r.data) })),
    cfg: await readCfg(env),
    history: hs.results.map(r => ({ id: r.id, ...JSON.parse(r.data) })),
    bounds: BOUNDS
  });
}

// POST {kind:"ana"|"err"|"ghost", rec}                         → simpan log (semua pengguna yang sudah masuk)
// POST {action:"apply", pg, before, report}                    → Super Admin: terapkan ambang baru + hapus log yang sudah dipakai
// POST {action:"rollback"}                                     → Super Admin: kembalikan ambang sebelumnya
export async function onRequestPost({ env, request }) {
  const text = await request.text();
  if (text.length > MAX_BODY) return J({ error: "Log terlalu besar" }, 413);
  let b; try { b = JSON.parse(text); } catch (e) { return J({ error: "JSON tidak valid" }, 400); }
  const w = await who(env, request);
  if (!w) return J({ error: "unauthorized" }, 401);

  if (b.action) {
    if (w.role !== "superadmin") return J({ error: "Hanya Super Admin" }, 403);
    const cur = await readCfg(env), now = Date.now();
    if (b.action === "apply") {
      const before = Number(b.before) || now;
      await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('pose_cfg',?,?)")
        .bind("h_" + now, JSON.stringify({ prev: cur, at: now, report: b.report || null })).run();
      const next = { pg: clampCfg(b.pg), ver: (cur.ver || 0) + 1, at: now, report: b.report || null };
      await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('pose_cfg','current',?)").bind(JSON.stringify(next)).run();
      const del = await env.DB.prepare("DELETE FROM docs WHERE coll='techlog' AND json_extract(data,'$.t') <= ?").bind(before).run();
      return J({ ok: true, cfg: next, deleted: (del.meta && del.meta.changes) || 0 });
    }
    if (b.action === "rollback") {
      const h = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='pose_cfg' AND id LIKE 'h\\_%' ESCAPE '\\' ORDER BY id DESC LIMIT 1").first();
      if (!h) return J({ error: "Belum ada setelan sebelumnya" }, 404);
      const prev = JSON.parse(h.data).prev || { pg: {}, ver: 0, at: 0 };
      const next = { ...prev, ver: (cur.ver || 0) + 1, at: now, rolledBack: true };
      await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('pose_cfg','current',?)").bind(JSON.stringify(next)).run();
      await env.DB.prepare("DELETE FROM docs WHERE coll='pose_cfg' AND id=?").bind(h.id).run();
      return J({ ok: true, cfg: next });
    }
    return J({ error: "Aksi tidak dikenal" }, 400);
  }

  if (!["ana", "err", "ghost"].includes(b.kind)) return J({ error: "Jenis log tidak dikenal" }, 400);
  if (!(await hitLimit(env, request, "tlog", 300, 864e5, w.clubId || "sa"))) return J({ error: "Terlalu banyak log hari ini" }, 429);
  const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  await env.DB.prepare("INSERT INTO docs(coll,id,data) VALUES('techlog',?,?)")
    .bind(id, JSON.stringify({ clubId: w.clubId || "", role: w.role, t: Date.now(), kind: b.kind, rec: b.rec || {} })).run();
  if (Math.random() < 0.05) await sweep(env);
  return J({ ok: true, id });
}
