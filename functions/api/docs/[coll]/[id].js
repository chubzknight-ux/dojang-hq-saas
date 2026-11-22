import { J, authenticate, getDoc, putDoc, delDoc, PROTECTED, hashPin } from "../../_auth.js";
import { audit } from "../../staff.js";

const valid = p => /^[a-z_]{1,30}$/.test(p.coll) && /^[A-Za-z0-9_-]{1,120}$/.test(p.id);
const readBody = async request => {
  if (Number(request.headers.get("content-length") || 0) > 2_000_000) return null;
  const b = await request.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? b : null;
};
const MAX_BODY = 2_000_000;
const tooBig = b => JSON.stringify(b).length > MAX_BODY;

// Data klub dari Super Admin: PIN baru di-hash dan tidak pernah disimpan sebagai teks.
// Bila PIN tidak diisi, hash lama dipertahankan (aplikasi tidak pernah menerima PIN, jadi tidak bisa mengirim ulang).
async function clubDoc(b, cur) {
  const { adminPin, adminPinHash: _ignored, ...rest } = b;
  const pin = String(adminPin || "").trim();
  if (pin) return { ...rest, adminPinHash: await hashPin(pin) };
  if (cur && cur.adminPinHash) return { ...rest, adminPinHash: cur.adminPinHash };
  if (cur && cur.adminPin) return { ...rest, adminPin: cur.adminPin }; // PIN lama (teks), di-hash saat admin klub masuk
  return rest;
}

// Nama yang mudah dibaca untuk Riwayat Aktivitas (murid: n, pelatih/unit: name)
const labelOf = d => { if (!d || typeof d !== "object") return ""; const v = d.n || d.name || d.judul || ""; return typeof v === "string" ? v.slice(0, 80) : ""; };
// Setiap simpan/hapus dari admin dicatat, supaya perubahan data bisa ditelusuri.
// Simpan berulang atas data yang sama dalam 10 menit digabung jadi satu baris.
const log = (env, auth, action, coll, id, d) => {
  const nm = labelOf(d);
  return audit(env, auth.clubId, auth.role === "superadmin" ? "Super Admin" : "Admin", "owner", action, nm ? { coll, id, nm } : { coll, id }, action === "data_simpan" ? 10 : 0);
};

// Koleksi khusus (akun pelatih, daftar klub) hanya lewat jalur masing-masing
const blocked = (params, auth) => params.coll !== "clubs" && PROTECTED.has(params.coll);

export async function onRequestPut({ params, env, request }) {
  const auth = await authenticate(env, request);
  if (!auth.ok) return J({ error: auth.error }, auth.status);
  if (!valid(params)) return J({ error: "bad id" }, 400);
  if (blocked(params, auth)) return J({ error: "forbidden" }, 403);

  const b = await readBody(request);
  if (!b) return J({ error: "bad body" }, 400);
  if (tooBig(b)) return J({ error: "too large" }, 413);

  if (params.coll === "clubs") {
    if (auth.role !== "superadmin") return J({ error: "forbidden" }, 403);
    const old = await env.DB.prepare("SELECT data FROM docs WHERE coll = 'clubs' AND id = ?").bind(params.id).first();
    await env.DB.prepare("INSERT OR REPLACE INTO docs(coll, id, data) VALUES('clubs', ?, ?)")
      .bind(params.id, JSON.stringify(await clubDoc(b, old ? JSON.parse(old.data) : null)))
      .run();
    return J({ ok: true });
  }

  if (!auth.clubId) return J({ error: "club context required" }, 400);

  const existing = await getDoc(env, auth.clubId, params.coll, params.id);
  if (existing && existing.foreign) return J({ error: "forbidden cross-tenant" }, 403);

  await putDoc(env, auth.clubId, params.coll, params.id, b);
  await log(env, auth, "data_simpan", params.coll, params.id, b);
  return J({ ok: true });
}

export async function onRequestPatch({ params, env, request }) {
  const auth = await authenticate(env, request);
  if (!auth.ok) return J({ error: auth.error }, auth.status);
  if (!valid(params)) return J({ error: "bad id" }, 400);
  if (blocked(params, auth)) return J({ error: "forbidden" }, 403);

  const b = await readBody(request);
  if (!b) return J({ error: "bad body" }, 400);
  if (tooBig(b)) return J({ error: "too large" }, 413);

  if (params.coll === "clubs") {
    if (auth.role !== "superadmin") return J({ error: "forbidden" }, 403);
    const cur = await env.DB.prepare("SELECT data FROM docs WHERE coll = 'clubs' AND id = ?").bind(params.id).first();
    const curD = cur ? JSON.parse(cur.data) : {};
    const merged = { ...curD, ...(await clubDoc(b, curD)) };
    await env.DB.prepare("INSERT OR REPLACE INTO docs(coll, id, data) VALUES('clubs', ?, ?)")
      .bind(params.id, JSON.stringify(merged))
      .run();
    return J({ ok: true });
  }

  if (!auth.clubId) return J({ error: "club context required" }, 400);

  const cur = await getDoc(env, auth.clubId, params.coll, params.id);
  if (cur && cur.foreign) return J({ error: "forbidden cross-tenant" }, 403);

  // PATCH biasa: gabungkan kolom teratas.
  // PATCH ?merge=ids (absensi & iuran): hanya centang yang dikirim yang diubah, centang lain (mis. dari pelatih) tetap.
  const mergeIds = new URL(request.url).searchParams.get("merge") === "ids";
  if (mergeIds && (!b.ids || typeof b.ids !== "object" || Array.isArray(b.ids))) return J({ error: "bad ids" }, 400);
  const old = cur ? cur.data : {};
  const merged = mergeIds ? { ...old, ...b, ids: { ...(old.ids && typeof old.ids === "object" ? old.ids : {}), ...b.ids } } : { ...old, ...b };
  await putDoc(env, auth.clubId, params.coll, params.id, merged);
  if (mergeIds) await audit(env, auth.clubId, auth.role === "superadmin" ? "Super Admin" : "Admin", "owner", "data_simpan", { coll: params.coll, id: params.id, set: b.ids }, 10);
  else await log(env, auth, "data_simpan", params.coll, params.id, merged);
  return J({ ok: true });
}

export async function onRequestDelete({ params, env, request }) {
  const auth = await authenticate(env, request);
  if (!auth.ok) return J({ error: auth.error }, auth.status);
  if (!valid(params)) return J({ error: "bad id" }, 400);
  if (blocked(params, auth)) return J({ error: "forbidden" }, 403);

  if (params.coll === "clubs") {
    if (auth.role !== "superadmin") return J({ error: "forbidden" }, 403);
    await env.DB.prepare("DELETE FROM docs WHERE coll = 'clubs' AND id = ?").bind(params.id).run();
    return J({ ok: true });
  }

  if (!auth.clubId) return J({ error: "club context required" }, 400);

  const cur = await getDoc(env, auth.clubId, params.coll, params.id);
  if (cur && cur.foreign) return J({ error: "forbidden cross-tenant" }, 403);

  await delDoc(env, auth.clubId, params.coll, params.id);
  if (cur && cur.data) await log(env, auth, "data_hapus", params.coll, params.id, cur.data);
  return J({ ok: true });
}
