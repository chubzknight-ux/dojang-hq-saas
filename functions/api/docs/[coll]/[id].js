import { J, authenticate, getDoc, putDoc, delDoc, PROTECTED } from "../../_auth.js";

const valid = p => /^[a-z_]{1,30}$/.test(p.coll) && /^[A-Za-z0-9_-]{1,120}$/.test(p.id);
const readBody = async request => {
  const b = await request.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? b : null;
};
const MAX_BODY = 2_000_000;
const tooBig = b => JSON.stringify(b).length > MAX_BODY;

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
    await env.DB.prepare("INSERT OR REPLACE INTO docs(coll, id, data) VALUES('clubs', ?, ?)")
      .bind(params.id, JSON.stringify(b))
      .run();
    return J({ ok: true });
  }

  if (!auth.clubId) return J({ error: "club context required" }, 400);

  const existing = await getDoc(env, auth.clubId, params.coll, params.id);
  if (existing && existing.foreign) return J({ error: "forbidden cross-tenant" }, 403);

  await putDoc(env, auth.clubId, params.coll, params.id, b);
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
    const merged = { ...(cur ? JSON.parse(cur.data) : {}), ...b };
    await env.DB.prepare("INSERT OR REPLACE INTO docs(coll, id, data) VALUES('clubs', ?, ?)")
      .bind(params.id, JSON.stringify(merged))
      .run();
    return J({ ok: true });
  }

  if (!auth.clubId) return J({ error: "club context required" }, 400);

  const cur = await getDoc(env, auth.clubId, params.coll, params.id);
  if (cur && cur.foreign) return J({ error: "forbidden cross-tenant" }, 403);

  await putDoc(env, auth.clubId, params.coll, params.id, { ...(cur ? cur.data : {}), ...b });
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
  return J({ ok: true });
}
