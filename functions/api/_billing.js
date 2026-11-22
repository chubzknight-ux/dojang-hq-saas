// Dojang HQ SaaS - inti sistem pembayaran langganan
// Koleksi (semua PROTECTED, tidak ikut sinkron /api/all dan tidak bisa diubah lewat API umum):
//   billing_settings/main : paket, harga, diskon durasi, rekening / QRIS untuk transfer manual
//   invoices              : tagihan (id "INV-<klub>-<acak>"), status pending | paid | rejected
// Pembayaran saat ini lewat transfer bank / QRIS statis yang DIVERIFIKASI MANUAL oleh Super Admin.
// (Integrasi pembayaran otomatis / payment gateway belum dipasang.)

const enc = new TextEncoder();
export const wibToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
export const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
export const DURATIONS = [1, 3, 6, 12];

export function addMonths(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export const DEFAULT_SETTINGS = {
  plans: [],                                   // [{id, name, price (Rp per bulan), note}]
  discounts: { "3": 0, "6": 0, "12": 0 },      // diskon % untuk durasi 3 / 6 / 12 bulan
  bank: { bank: "", number: "", holder: "" },  // untuk transfer manual
  qrisImage: "",                               // data URI gambar QRIS statis (opsional)
  contactWa: ""                                // nomor WA admin pembayaran (opsional)
};

export async function loadSettings(env) {
  const row = await env.DB.prepare("SELECT data FROM docs WHERE coll='billing_settings' AND id='main'").first();
  let s = {};
  try { s = row ? JSON.parse(row.data) : {}; } catch (e) { s = {}; }
  return {
    plans: Array.isArray(s.plans) ? s.plans.filter(p => p && p.id && Number(p.price) > 0) : [],
    discounts: { ...DEFAULT_SETTINGS.discounts, ...(s.discounts || {}) },
    bank: { ...DEFAULT_SETTINGS.bank, ...(s.bank || {}) },
    qrisImage: typeof s.qrisImage === "string" ? s.qrisImage : "",
    contactWa: clip(s.contactWa, 20)
  };
}

// Harga: price * bulan, dikurangi diskon durasi. Dibulatkan ke Rp 1.000 terdekat supaya angkanya rapi.
export function priceFor(plan, months, settings) {
  const disc = Math.min(90, Math.max(0, Number(settings.discounts[String(months)]) || 0));
  const gross = Number(plan.price) * months;
  return Math.max(1000, Math.round(gross * (100 - disc) / 100 / 1000) * 1000);
}

export async function loadClubRow(env, clubId) {
  const row = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='clubs' AND id=?").bind(clubId).first();
  if (!row) return null;
  try { return { id: row.id, ...JSON.parse(row.data) }; } catch (e) { return null; }
}

export async function loadInvoice(env, id) {
  const row = await env.DB.prepare("SELECT data FROM docs WHERE coll='invoices' AND id=?").bind(id).first();
  if (!row) return null;
  try { return { id, ...JSON.parse(row.data) }; } catch (e) { return null; }
}
export async function saveInvoice(env, inv) {
  const { id, ...rest } = inv;
  await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('invoices',?,?)").bind(id, JSON.stringify(rest)).run();
}

// Tandai lunas dan perpanjang masa aktif klub. Aman dipanggil berulang (webhook dobel, klik ganda):
// hanya pemanggil yang berhasil mengubah status "belum lunas" -> "paid" yang memperpanjang.
export async function markPaid(env, invId, via, extra) {
  const inv = await loadInvoice(env, invId);
  if (!inv) return { error: "Tagihan tidak ditemukan." };
  if (inv.status === "paid") return { already: true, invoice: inv };
  const paid = { ...inv, status: "paid", paidAt: Date.now(), paidVia: via, ...(extra || {}) };
  const { id, ...rest } = paid;
  const r = await env.DB.prepare(
    "UPDATE docs SET data=? WHERE coll='invoices' AND id=? AND coalesce(json_extract(data,'$.status'),'') != 'paid'"
  ).bind(JSON.stringify(rest), invId).run();
  const changed = r && r.meta ? r.meta.changes : 1;
  if (!changed) return { already: true, invoice: await loadInvoice(env, invId) };
  const club = await loadClubRow(env, inv.clubId);
  if (!club) return { error: "Klub tidak ditemukan.", invoice: paid };
  const today = wibToday();
  const base = club.expiresAt && String(club.expiresAt) > today ? String(club.expiresAt) : today;
  const expiresAt = addMonths(base, inv.months);
  const { id: _i, ...clubData } = club;
  const next = { ...clubData, expiresAt, plan: inv.plan || club.plan, status: "active" };
  await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('clubs',?,?)").bind(club.id, JSON.stringify(next)).run();
  return { ok: true, invoice: paid, expiresAt };
}

export const publicInvoice = inv => inv && ({
  id: inv.id, clubId: inv.clubId, plan: inv.plan, months: inv.months, amount: inv.amount, total: inv.total || inv.amount,
  status: inv.status, method: inv.method, url: inv.url || "", createdAt: inv.createdAt, paidAt: inv.paidAt || 0,
  claimed: !!inv.claimed
});

export const randId = n => {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(a, b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
};
export { enc };
