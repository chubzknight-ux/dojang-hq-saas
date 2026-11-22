// Dojang HQ SaaS - API pembayaran langganan
//
// PUBLIK (tanpa login, cukup kode klub; supaya klub yang masa aktifnya sudah habis tetap bisa membayar):
//   GET  /api/billing?club=KODE          info klub, paket + harga, cara bayar, tagihan yang masih menunggu
//   GET  /api/billing?invoice=ID         status satu tagihan (otomatis dicocokkan dengan Xendit)
//   POST {action:"create", club, plan, months, method:"gateway"|"manual", name}   buat tagihan
//   POST {action:"claim", invoice, note}                                         "Saya sudah transfer" (manual)
// SUPER ADMIN (header login Super Admin):
//   GET  /api/billing?list=1             pengaturan lengkap + daftar tagihan
//   POST {action:"settings", settings}   simpan paket / harga / rekening / QRIS
//   POST {action:"confirm", invoice}     konfirmasi pembayaran manual -> masa aktif otomatis diperpanjang
//   POST {action:"reject", invoice}      tolak / batalkan tagihan
//   POST {action:"record", club, plan, months, amount, note}   catat pembayaran yang diterima di luar sistem (tunai, dll.)
import { authenticate, cleanSlug } from "./_auth.js";
import { hitLimit } from "./staff.js";
import {
  DURATIONS, clip, wibToday, loadSettings, priceFor, loadClubRow, loadInvoice, saveInvoice, markPaid,
  xenditOn, xenditCreate, syncInvoice, publicInvoice, randId
} from "./_billing.js";

const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const clubView = c => ({
  id: c.id, name: c.name || c.id, plan: c.plan || "", expiresAt: c.expiresAt || "", status: c.status || "active",
  headCoach: c.headCoach || "", logo: c.logo && c.logo.length < 60000 ? c.logo : ""
});

function cleanSettings(s) {
  s = s || {};
  const plans = [];
  const seen = new Set();
  for (const p of Array.isArray(s.plans) ? s.plans.slice(0, 8) : []) {
    const name = clip(p && p.name, 40).trim();
    const price = Math.round(Number(p && p.price));
    if (!name || !(price > 0) || price > 100000000) continue;
    let id = cleanSlug(p.id || name) || "paket";
    while (seen.has(id)) id += "x";
    seen.add(id);
    plans.push({ id, name, price, note: clip(p.note, 120) });
  }
  const dc = {};
  for (const k of ["3", "6", "12"]) dc[k] = Math.min(90, Math.max(0, Math.round(Number(s.discounts && s.discounts[k]) || 0)));
  const b = s.bank || {};
  const qris = typeof s.qrisImage === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(s.qrisImage) && s.qrisImage.length < 600000 ? s.qrisImage : "";
  return {
    plans, discounts: dc,
    bank: { bank: clip(b.bank, 40), number: clip(b.number, 40), holder: clip(b.holder, 60) },
    qrisImage: qris,
    contactWa: clip(s.contactWa, 20).replace(/[^0-9]/g, "")
  };
}

export async function onRequestGet({ env, request }) {
  const u = new URL(request.url);

  if (u.searchParams.has("list")) {
    const a = await authenticate(env, request);
    if (!a.ok || a.role !== "superadmin") return J({ error: "Hanya Super Admin." }, 403);
    const rs = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='invoices'").all();
    const list = [];
    for (const r of rs.results) { try { list.push({ id: r.id, ...JSON.parse(r.data) }); } catch (e) { /* lewati */ } }
    list.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
    const settings = await loadSettings(env);
    return J({ settings, invoices: list.slice(0, 200), gateway: xenditOn(env), hookReady: !!env.XENDIT_CALLBACK_TOKEN });
  }

  if (!(await hitLimit(env, request, "payget", 120, 10 * 60000))) return J({ error: "Terlalu banyak permintaan. Coba lagi sebentar." }, 429);

  const invId = u.searchParams.get("invoice");
  if (invId) {
    if (!/^INV-[a-z0-9_-]+-[a-z0-9]+$/i.test(invId)) return J({ error: "Tagihan tidak ditemukan." }, 404);
    let inv = await loadInvoice(env, invId);
    if (!inv) return J({ error: "Tagihan tidak ditemukan." }, 404);
    inv = await syncInvoice(env, inv);
    const club = await loadClubRow(env, inv.clubId);
    return J({ invoice: publicInvoice(inv), club: club ? clubView(club) : null });
  }

  const clubId = cleanSlug(u.searchParams.get("club") || "");
  if (!clubId) return J({ error: "Kode dojang kosong." }, 400);
  const club = await loadClubRow(env, clubId);
  if (!club) return J({ error: "Kode dojang tidak ditemukan." }, 404);
  const s = await loadSettings(env);
  // tagihan menunggu terakhir milik klub ini (supaya tidak membuat dobel)
  const rs = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='invoices' AND json_extract(data,'$.clubId')=?").bind(clubId).all();
  let invs = [];
  for (const r of rs.results) { try { invs.push({ id: r.id, ...JSON.parse(r.data) }); } catch (e) { /* lewati */ } }
  invs.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
  let pending = invs.find(i => i.status === "pending" && (i.method === "manual" || (Date.now() - i.createdAt) < 3 * 864e5 - 3600e3)) || null;
  if (pending) pending = await syncInvoice(env, pending);
  if (pending && pending.status !== "pending") pending = null;
  const history = invs.filter(i => i.status === "paid").slice(0, 6).map(publicInvoice);
  const manualReady = !!(s.bank.number || s.qrisImage);
  return J({
    club: clubView(club),
    today: wibToday(),
    plans: s.plans,
    discounts: s.discounts,
    durations: DURATIONS,
    gateway: xenditOn(env),
    manual: manualReady ? { bank: s.bank, qrisImage: s.qrisImage } : null,
    contactWa: s.contactWa,
    pending: pending ? { ...publicInvoice(pending), uniq: pending.uniq || 0 } : null,
    history
  });
}

export async function onRequestPost({ env, request }) {
  const b = await request.json().catch(() => null);
  if (!b || !b.action) return J({ error: "Permintaan tidak lengkap." }, 400);
  const action = String(b.action);

  // ===== Super Admin =====
  if (["settings", "confirm", "reject", "record"].includes(action)) {
    const a = await authenticate(env, request);
    if (!a.ok || a.role !== "superadmin") return J({ error: "Hanya Super Admin." }, 403);

    if (action === "settings") {
      const s = cleanSettings(b.settings);
      await env.DB.prepare("INSERT OR REPLACE INTO docs(coll,id,data) VALUES('billing_settings','main',?)").bind(JSON.stringify(s)).run();
      return J({ ok: true, settings: await loadSettings(env) });
    }
    if (action === "confirm") {
      const inv = await loadInvoice(env, String(b.invoice || ""));
      if (!inv) return J({ error: "Tagihan tidak ditemukan." }, 404);
      if (inv.status === "rejected" || inv.status === "expired") return J({ error: "Tagihan sudah " + (inv.status === "rejected" ? "ditolak" : "kedaluwarsa") + "." }, 409);
      const r = await markPaid(env, inv.id, "manual", { confirmedBy: "superadmin" });
      if (r.error) return J({ error: r.error }, 500);
      return J({ ok: true, already: !!r.already, expiresAt: r.expiresAt || "" });
    }
    if (action === "reject") {
      const inv = await loadInvoice(env, String(b.invoice || ""));
      if (!inv) return J({ error: "Tagihan tidak ditemukan." }, 404);
      if (inv.status === "paid") return J({ error: "Tagihan sudah lunas." }, 409);
      await saveInvoice(env, { ...inv, status: "rejected", rejectedAt: Date.now() });
      return J({ ok: true });
    }
    if (action === "record") {
      const club = await loadClubRow(env, cleanSlug(b.club || ""));
      if (!club) return J({ error: "Klub tidak ditemukan." }, 404);
      const months = Number(b.months);
      if (!Number.isInteger(months) || months < 1 || months > 36) return J({ error: "Jumlah bulan tidak valid." }, 400);
      const id = "INV-" + club.id + "-" + randId(8);
      const amount = Math.max(0, Math.round(Number(b.amount) || 0));
      await saveInvoice(env, {
        id, clubId: club.id, plan: clip(b.plan || club.plan, 40), months, amount, total: amount, method: "manual",
        status: "pending", createdAt: Date.now(), note: clip(b.note, 200), recorded: true
      });
      const r = await markPaid(env, id, "tunai", { confirmedBy: "superadmin" });
      return J({ ok: true, expiresAt: r.expiresAt || "" });
    }
  }

  // ===== Publik =====
  if (!(await hitLimit(env, request, "paypost", 30, 60 * 60000))) return J({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, 429);

  if (action === "claim") {
    const inv = await loadInvoice(env, String(b.invoice || ""));
    if (!inv || inv.method !== "manual") return J({ error: "Tagihan tidak ditemukan." }, 404);
    if (inv.status !== "pending") return J({ ok: true, status: inv.status });
    await saveInvoice(env, { ...inv, claimed: true, claimedAt: Date.now(), claimNote: clip(b.note, 200) });
    return J({ ok: true });
  }

  if (action === "create") {
    const club = await loadClubRow(env, cleanSlug(b.club || ""));
    if (!club) return J({ error: "Kode dojang tidak ditemukan." }, 404);
    const s = await loadSettings(env);
    const plan = s.plans.find(p => p.id === String(b.plan || ""));
    if (!plan) return J({ error: "Paket belum tersedia. Hubungi pengelola dojang." }, 400);
    const months = Number(b.months);
    if (!DURATIONS.includes(months)) return J({ error: "Durasi tidak valid." }, 400);
    const method = b.method === "manual" ? "manual" : "gateway";
    if (method === "gateway" && !xenditOn(env)) return J({ error: "Pembayaran online belum aktif. Pakai transfer manual." }, 400);
    if (method === "manual" && !(s.bank.number || s.qrisImage)) return J({ error: "Transfer manual belum diatur." }, 400);

    const amount = priceFor(plan, months, s);
    const payer = clip(b.name, 60).trim();
    const id = "INV-" + club.id + "-" + randId(8);
    const inv = {
      id, clubId: club.id, plan: plan.id, planName: plan.name, months, amount, total: amount, method,
      status: "pending", createdAt: Date.now(), payer
    };

    // bila ada tagihan manual yang masih menunggu untuk paket & durasi yang sama, pakai lagi (tidak bikin dobel)
    if (method === "manual") {
      const rs = await env.DB.prepare("SELECT id, data FROM docs WHERE coll='invoices' AND json_extract(data,'$.clubId')=?").bind(club.id).all();
      for (const r of rs.results) {
        let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
        if (d.status === "pending" && d.method === "manual" && d.plan === plan.id && d.months === months) {
          return J({ invoice: { ...publicInvoice({ id: r.id, ...d }), uniq: d.uniq || 0 } });
        }
      }
      // kode unik 3 digit di belakang nominal supaya transfer mudah dicocokkan
      const taken = new Set();
      const all = await env.DB.prepare("SELECT data FROM docs WHERE coll='invoices' AND json_extract(data,'$.status')='pending' AND json_extract(data,'$.method')='manual'").all();
      for (const r of all.results) { try { taken.add(JSON.parse(r.data).total); } catch (e) { /* lewati */ } }
      let uniq = 0;
      for (let i = 0; i < 30; i++) {
        uniq = 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % 999);
        if (!taken.has(amount + uniq)) break;
      }
      inv.uniq = uniq;
      inv.total = amount + uniq;
      await saveInvoice(env, inv);
      return J({ invoice: { ...publicInvoice(inv), uniq } });
    }

    const origin = new URL(request.url).origin;
    const back = origin + "/?bayar=1&club=" + encodeURIComponent(club.id) + "&inv=" + encodeURIComponent(id);
    try {
      const x = await xenditCreate(env, {
        externalId: id,
        amount,
        description: "Langganan Dojang HQ " + (club.name || club.id) + " - " + plan.name + " " + months + " bulan",
        payerName: payer,
        successUrl: back, failureUrl: back
      });
      inv.xid = x.id;
      inv.url = x.invoice_url;
      await saveInvoice(env, inv);
      return J({ invoice: publicInvoice(inv) });
    } catch (e) {
      return J({ error: "Gagal membuat tagihan online: " + clip(e.message, 120) }, 502);
    }
  }

  return J({ error: "Aksi tidak dikenal." }, 400);
}
