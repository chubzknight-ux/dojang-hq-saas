export const J = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });

export const cleanSlug = s =>
  String(s || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");

export async function authenticate(env, req) {
  const user = String(req.headers.get("X-Dojang-User") || "").trim().toLowerCase();
  const pin = String(req.headers.get("X-Dojang-Pin") || "").trim();
  const targetClub = cleanSlug(req.headers.get("X-Target-Club") || "");

  const saUser = String(env.SUPERADMIN_USER || "superadmin").trim().toLowerCase();
  const saPin = String(env.SUPERADMIN_PIN || env.DOJANG_PIN || "251025").trim();

  if (user && pin && user === saUser && pin === saPin) {
    let club = null;
    if (targetClub) {
      const row = await env.DB.prepare("SELECT id, data FROM docs WHERE coll = 'clubs' AND id = ?").bind(targetClub).first();
      if (row) club = { id: row.id, ...JSON.parse(row.data) };
    }
    return { ok: true, role: "superadmin", clubId: club ? club.id : null, club };
  }

  if (!user || !pin) return { ok: false, status: 403, error: "Username atau PIN kosong" };

  const rs = await env.DB.prepare("SELECT id, data FROM docs WHERE coll = 'clubs'").all();
  for (const r of rs.results) {
    const c = JSON.parse(r.data);
    const cUser = String(c.adminUser || r.id || "").trim().toLowerCase();
    const cPin = String(c.adminPin || "").trim();
    if (cUser === user && cPin && cPin === pin) {
      if (c.status === "suspended") {
        return { ok: false, status: 402, error: "Akun dojang sedang dinonaktifkan sementara. Hubungi penyedia sistem Dojang HQ." };
      }
      if (c.expiresAt) {
        const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
        if (String(c.expiresAt) < today) {
          return { ok: false, status: 402, error: "Masa aktif langganan Dojang HQ telah berakhir pada " + c.expiresAt + ". Silakan perpanjang lisensi." };
        }
      }
      return { ok: true, role: "club", clubId: r.id, club: { id: r.id, ...c } };
    }
  }

  return { ok: false, status: 403, error: "Username atau PIN salah" };
}