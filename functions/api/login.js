import { J, cleanSlug, ensureSchema, passwordAuth, makeAdminToken } from "./_auth.js";

// POST /api/login  {user, pin}  → {token, role}
// Token dipakai aplikasi sebagai pengganti PIN (header X-Dojang-Admin-Token); PIN tidak perlu disimpan di perangkat.
export async function onRequestPost({ env, request }) {
  if (!env.TOKEN_SECRET) return J({ error: "TOKEN_SECRET belum diisi di Cloudflare (lihat SETUP.md)." }, 500);
  await ensureSchema(env);
  const b = await request.json().catch(() => null);
  const user = String((b && b.user) || "").trim().toLowerCase();
  const pin = String((b && b.pin) || "").trim();
  const a = await passwordAuth(env, request, user, pin, cleanSlug((b && b.targetClub) || ""));
  if (!a.ok) return J({ error: a.error, payClub: a.payClub || "" }, a.status);
  const t = a.tokenInfo;
  return J({ token: await makeAdminToken(env, t.role, t.user, t.clubId, t.pv), role: a.role });
}
