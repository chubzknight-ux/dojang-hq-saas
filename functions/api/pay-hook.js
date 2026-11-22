// Webhook Xendit: dipanggil Xendit saat tagihan dibayar / kedaluwarsa.
// Atur di Xendit Dashboard -> Settings -> Webhooks -> Invoices paid/expired:
//   https://<domain-anda>/api/pay-hook   dan salin "Verification Token" ke variabel XENDIT_CALLBACK_TOKEN.
import { loadInvoice, syncInvoice, xenditOn } from "./_billing.js";

const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const eq = (a, b) => { a = String(a || ""); b = String(b || ""); if (!a || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

export async function onRequestPost({ env, request }) {
  if (!xenditOn(env) || !env.XENDIT_CALLBACK_TOKEN) return J({ error: "Webhook belum diatur" }, 503);
  if (!eq(request.headers.get("x-callback-token"), env.XENDIT_CALLBACK_TOKEN)) return J({ error: "Token salah" }, 401);
  const b = await request.json().catch(() => null);
  const ref = String((b && b.external_id) || "");
  if (!/^INV-[a-z0-9_-]+-[a-z0-9]+$/i.test(ref)) return J({ ok: true, ignored: true });
  const inv = await loadInvoice(env, ref);
  if (!inv) return J({ ok: true, ignored: true });
  // status diverifikasi ulang langsung ke Xendit (bukan sekadar percaya isi webhook)
  const out = await syncInvoice(env, inv);
  return J({ ok: true, status: out.status });
}
