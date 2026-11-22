// Dojang HQ SaaS - inti sistem pembayaran langganan
// Koleksi (semua PROTECTED, tidak ikut sinkron /api/all dan tidak bisa diubah lewat API umum):
//   billing_settings/main : paket, harga, diskon durasi, rekening / QRIS untuk transfer manual
//   invoices              : tagihan (id "INV-<klub>-<waktu>"), status pending | paid | expired | rejected
// Pembayaran otomatis memakai Xendit Invoice (QRIS, Virtual Account, e-wallet, kartu, minimarket dalam SATU halaman bayar).
// Tanpa kunci Xendit, sistem tetap jalan lewat transfer manual yang dikonfirmasi Super Admin.

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

// ===== Skema paket bawaan =====
// Batas dipaksakan server (bukan sekadar label): maxStudents = murid aktif (0 = tanpa batas), maxUnits = jumlah unit/cabang
// (0 = tanpa batas), ai = boleh memakai Analisa Video AI Cloud. Super Admin bisa mengubah semuanya di menu Pembayaran.
export const DEFAULT_PLANS = [
  { id: "basic", name: "Basic", price: 59000, note: "Sampai 60 murid · 1 unit", maxStudents: 60, maxUnits: 1, ai: false },
  { id: "pro", name: "Pro", price: 129000, note: "Murid tanpa batas · multi-unit · Analisa Video AI", maxStudents: 0, maxUnits: 0, ai: true }
];
export const DEFAULT_SETTINGS = {
  plans: DEFAULT_PLANS,                        // [{id, name, price (Rp per bulan), note, maxStudents, maxUnits, ai}]
  discounts: { "3": 5, "6": 10, "12": 20 },    // diskon % durasi 3 / 6 / 12 bulan (12 bln = hemat ~2,4 bulan)
  bank: { bank: "", number: "", holder: "" },  // untuk transfer manual
  qrisImage: "",                               // data URI gambar QRIS statis (opsional)
  contactWa: ""                                // nomor WA admin pembayaran (opsional)
};
export const normPlan = p => ({
  id: String(p.id), name: String(p.name || p.id), price: Number(p.price) || 0, note: String(p.note || ""),
  maxStudents: Math.max(0, Math.round(Number(p.maxStudents) || 0)), maxUnits: Math.max(0, Math.round(Number(p.maxUnits) || 0)), ai: !!p.ai
});

export async function loadSettings(env) {
  const row = await env.DB.prepare("SELECT data FROM docs WHERE coll='billing_settings' AND id='main'").first();
  let s = null;
  try { s = row ? JSON.parse(row.data) : null; } catch (e) { s = null; }
  const d = DEFAULT_SETTINGS;
  const plans = s && Array.isArray(s.plans) ? s.plans.filter(p => p && p.id && Number(p.price) > 0).map(normPlan) : d.plans.map(normPlan);
  return {
    plans,
    discounts: { ...d.discounts, ...((s && s.discounts) || {}) },
    bank: { ...d.bank, ...((s && s.bank) || {}) },
    qrisImage: s && typeof s.qrisImage === "string" ? s.qrisImage : "",
    contactWa: clip(s && s.contactWa, 20)
  };
}

// Paket milik klub (dicocokkan dari nama paket di data klub). null = paket tidak dikenal -> tanpa batas (klub lama tidak diblokir).
export async function planOfClub(env, club) {
  const s = await loadSettings(env);
  const key = String((club && club.plan) || "").trim().toLowerCase();
  return s.plans.find(p => p.id === key || p.name.toLowerCase() === key) || null;
}
export async function usageOf(env, clubId) {
  const st = await env.DB.prepare("SELECT COUNT(*) AS n FROM docs WHERE coll='students' AND json_extract(data,'$.clubId')=? AND coalesce(json_extract(data,'$.cuti'),0) IN (0,'false')").bind(clubId).first();
  const un = await env.DB.prepare("SELECT COUNT(*) AS n FROM docs WHERE coll='units' AND json_extract(data,'$.clubId')=?").bind(clubId).first();
  return { students: (st && st.n) || 0, units: (un && un.n) || 0 };
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
  const next = { ...clubData, expiresAt, plan: inv.planName || inv.plan || club.plan, status: "active" };
  await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('clubs',?,?)").bind(club.id, JSON.stringify(next)).run();
  return { ok: true, invoice: paid, expiresAt };
}

// ===== Xendit =====
export const xenditOn = env => !!String(env.XENDIT_SECRET_KEY || "").trim();
const xAuth = env => "Basic " + btoa(String(env.XENDIT_SECRET_KEY).trim() + ":");

export async function xenditCreate(env, { externalId, amount, description, payerName, successUrl, failureUrl }) {
  const res = await fetch("https://api.xendit.co/v2/invoices", {
    method: "POST",
    headers: { Authorization: xAuth(env), "content-type": "application/json" },
    body: JSON.stringify({
      external_id: externalId,
      amount,
      currency: "IDR",
      description,
      invoice_duration: 3 * 86400,
      customer: payerName ? { given_names: clip(payerName, 60) } : undefined,
      success_redirect_url: successUrl,
      failure_redirect_url: failureUrl
    })
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.invoice_url) throw new Error(d.message || ("Xendit HTTP " + res.status));
  return d;
}
export async function xenditGet(env, xid) {
  const res = await fetch("https://api.xendit.co/v2/invoices/" + encodeURIComponent(xid), { headers: { Authorization: xAuth(env) } });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.message || ("Xendit HTTP " + res.status));
  return d;
}
export const xenditPaid = d => d && (d.status === "PAID" || d.status === "SETTLED");

// Cocokkan status tagihan dengan Xendit (dipakai saat pelanggan kembali dari halaman bayar, dan oleh webhook).
export async function syncInvoice(env, inv) {
  if (!inv || inv.status !== "pending" || inv.method !== "gateway" || !inv.xid || !xenditOn(env)) return inv;
  try {
    const x = await xenditGet(env, inv.xid);
    // jangan percaya nominal / referensi yang tidak cocok
    if (x.external_id !== inv.id || Number(x.amount) !== Number(inv.amount)) return inv;
    if (xenditPaid(x)) {
      const r = await markPaid(env, inv.id, "xendit", { channel: clip(x.payment_channel || x.payment_method, 40) });
      return r.invoice || inv;
    }
    if (x.status === "EXPIRED") {
      const up = { ...inv, status: "expired" };
      await saveInvoice(env, up);
      return up;
    }
  } catch (e) { /* biarkan pending; dicoba lagi nanti */ }
  return inv;
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
