import { J, authenticate } from "../../_auth.js";

const valid = p => /^[a-z_]{1,30}$/.test(p.coll) && /^[A-Za-z0-9_-]{1,80}$/.test(p.id);
const readBody = async request => {
  const b = await request.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? b : null;
};

export async function onRequestPut({ params, env, request }) {
  const auth = await authenticate(env, request);
  if (!auth.ok) return J({ error: auth.error }, auth.status);
  if (!valid(params)) return J({ error: "bad id" }, 400);

  const b = await readBody(request);
  if (!b) return J({ error: "bad body" }, 400);

  if (params.coll === "clubs") {
    if (auth.role !== "superadmin") return J({ error: "forbidden" }, 403);
    await env.DB.prepare("INSERT OR REPLACE INTO docs(coll, id, data) VALUES('clubs', ?, ?)")
      .bind(params.id, JSON.stringify(b))
      .run();
    return J({ ok: true });
  }

  if (!auth.clubId) return J({ error: "club context required" }, 400);

  const existing = await env.DB.prepare("SELECT data FROM docs WHERE coll = ? AND id = ?")
    .bind(params.coll, params.id)
    .first();
  if (existing) {
    const exData = JSON.parse(existing.data);
    if (exData.clubId && exData.clubId !== auth.clubId) {
      return J({ error: "forbidden cross-tenant" }, 403);
    }
  }

  const payload = { ...b, clubId: auth.clubId };
  await env.DB.prepare("INSERT OR REPLACE INTO docs(coll, id, data) VALUES(?, ?, ?)")
    .bind(params.coll, params.id, JSON.stringify(payload))
    .run();
  return J({ ok: true });
}

export async function onRequestPatch({ params, env, request }) {
  const auth = await authenticate(env, request);
  if (!auth.ok) return J({ error: auth.error }, auth.status);
  if (!valid(params)) return J({ error: "bad id" }, 400);

  const b = await readBody(request);
  if (!b) return J({ error: "bad body" }, 400);

  if (params.coll === "clubs" && auth.role !== "superadmin") {
    return J({ error: "forbidden" }, 403);
  }

  const cur = await env.DB.prepare("SELECT data FROM docs WHERE coll = ? AND id = ?")
    .bind(params.coll, params.id)
    .first();
  const prev = cur ? JSON.parse(cur.data) : {};

  if (params.coll !== "clubs" && prev.clubId && prev.clubId !== auth.clubId) {
    return J({ error: "forbidden cross-tenant" }, 403);
  }

  const merged = params.coll === "clubs"
    ? { ...prev, ...b }
    : { ...prev, ...b, clubId: auth.clubId };

  await env.DB.prepare("INSERT OR REPLACE INTO docs(coll, id, data) VALUES(?, ?, ?)")
    .bind(params.coll, params.id, JSON.stringify(merged))
    .run();
  return J({ ok: true });
}

export async function onRequestDelete({ params, env, request }) {
  const auth = await authenticate(env, request);
  if (!auth.ok) return J({ error: auth.error }, auth.status);
  if (!valid(params)) return J({ error: "bad id" }, 400);

  if (params.coll === "clubs") {
    if (auth.role !== "superadmin") return J({ error: "forbidden" }, 403);
    await env.DB.prepare("DELETE FROM docs WHERE coll = 'clubs' AND id = ?").bind(params.id).run();
    return J({ ok: true });
  }

  if (!auth.clubId) return J({ error: "club context required" }, 400);

  const cur = await env.DB.prepare("SELECT data FROM docs WHERE coll = ? AND id = ?")
    .bind(params.coll, params.id)
    .first();
  if (cur) {
    const prev = JSON.parse(cur.data);
    if (prev.clubId && prev.clubId !== auth.clubId) {
      return J({ error: "forbidden cross-tenant" }, 403);
    }
  }

  await env.DB.prepare("DELETE FROM docs WHERE coll = ? AND id = ?")
    .bind(params.coll, params.id)
    .run();
  return J({ ok: true });
}