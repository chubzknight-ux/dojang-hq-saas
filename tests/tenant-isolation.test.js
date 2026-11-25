// Test isolasi antar klub (multi-tenant) pada API asli dengan database SQLite di memori.
// Tujuan: satu klub TIDAK BOLEH bisa membaca, mengubah, atau menghapus data klub lain, dan pembatas percobaan tidak bisa dilewati.
// Jalankan: node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const { HAS_SQLITE, world } = require("./_harness.js");

const opt = { skip: HAS_SQLITE ? false : "butuh Node 22.5+ (node:sqlite)" };

async function twoClubs(extraEnv) {
  const w = await world(extraEnv);
  const G = await w.login("garuda", "pin-garuda-1", "1.1.1.1");
  const M = await w.login("macan", "pin-macan-2", "2.2.2.2");
  assert.ok(G && M, "login dua klub harus berhasil");
  return { ...w, G, M };
}

test("login: PIN salah ditolak, benar dapat token", opt, async () => {
  const w = await world();
  assert.equal(await w.login("garuda", "salah-total"), null);
  assert.ok(await w.login("garuda", "pin-garuda-1"));
});

test("klub A menyimpan murid; klub B tidak melihatnya di /api/all", opt, async () => {
  const { call, G, M } = await twoClubs();
  assert.equal((await call("PUT", "/api/docs/students/ali-1", { headers: G, body: { n: "Ali" } })).status, 200);
  const a = await call("GET", "/api/all", { headers: G });
  const b = await call("GET", "/api/all", { headers: M });
  assert.deepEqual((a.body.data.students || []).map(s => s.id), ["ali-1"]);
  assert.deepEqual(b.body.data.students || [], []);
});

test("klub B tidak bisa menimpa, mengubah, atau menghapus murid klub A (PUT/PATCH/DELETE → 403)", opt, async () => {
  const { call, dbRow, G, M } = await twoClubs();
  await call("PUT", "/api/docs/students/ali-1", { headers: G, body: { n: "Ali", sabuk: "putih" } });
  for (const [m, body] of [["PUT", { n: "DIRETAS" }], ["PATCH", { n: "DIRETAS" }], ["DELETE", undefined]]) {
    const r = await call(m, "/api/docs/students/ali-1", { headers: M, body });
    assert.equal(r.status, 403, m + " harus ditolak");
  }
  const row = dbRow("students", "ali-1");
  assert.equal(row.n, "Ali");
  assert.equal(row.clubId, "garuda");
});

test("clubId di body diabaikan: data selalu dicap klub dari sesi login", opt, async () => {
  const { call, dbRow, M } = await twoClubs();
  await call("PUT", "/api/docs/students/budi-1", { headers: M, body: { n: "Budi", clubId: "garuda" } });
  assert.equal(dbRow("students", "budi-1").clubId, "macan");
});

test("koleksi beralamat klub (absensi) aman dari bentrok id antar klub", opt, async () => {
  const { call, G, M } = await twoClubs();
  await call("PUT", "/api/docs/attendance/2026-11-18", { headers: G, body: { ids: { a: 1 } } });
  await call("PUT", "/api/docs/attendance/2026-11-18", { headers: M, body: { ids: { b: 1 } } });
  const a = (await call("GET", "/api/all", { headers: G })).body.data.attendance;
  const b = (await call("GET", "/api/all", { headers: M })).body.data.attendance;
  assert.deepEqual(a[0].ids, { a: 1 });
  assert.deepEqual(b[0].ids, { b: 1 });
});

test("balapan: dua klub menyimpan id murid yang sama bersamaan → hanya satu menang, data tidak tertimpa", opt, async () => {
  const { call, dbRow, G, M } = await twoClubs();
  const rs = await Promise.all([
    call("PUT", "/api/docs/students/sama-1", { headers: G, body: { n: "dari garuda" } }),
    call("PUT", "/api/docs/students/sama-1", { headers: M, body: { n: "dari macan" } })
  ]);
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 403]);
  const row = dbRow("students", "sama-1");
  assert.equal(row.n, row.clubId === "garuda" ? "dari garuda" : "dari macan");
});

test("koleksi internal tidak bisa ditulis lewat API umum", opt, async () => {
  const { call, G } = await twoClubs();
  for (const coll of ["staff", "clubs", "invoices", "techlog", "pose_cfg", "audit_log", "billing_settings", "ai_usage"]) {
    const r = await call("PUT", "/api/docs/" + coll + "/x", { headers: G, body: { a: 1 } });
    assert.ok([403].includes(r.status), coll + " harus 403, dapat " + r.status);
  }
});

test("admin klub tidak bisa membuat/mengubah klub (hanya Super Admin)", opt, async () => {
  const { call, dbRow, G } = await twoClubs();
  assert.equal((await call("PUT", "/api/docs/clubs/macan", { headers: G, body: { name: "ambil alih" } })).status, 403);
  assert.equal(dbRow("clubs", "macan").name, "Macan");
});

test("endpoint khusus Super Admin menolak admin klub", opt, async () => {
  const { call, G } = await twoClubs();
  assert.equal((await call("GET", "/api/techlog", { headers: G })).status, 403);
  assert.equal((await call("GET", "/api/billing?list=1", { headers: G })).status, 403);
});

test("Super Admin bisa melihat daftar klub; admin klub hanya melihat klubnya sendiri", opt, async () => {
  const w = await world();
  const SA = await w.login("superadmin", "super-test-2026-abc", "9.9.9.9");
  assert.ok(SA);
  const r = await w.call("GET", "/api/all", { headers: SA });
  assert.deepEqual(r.body.clubs.map(c => c.id).sort(), ["garuda", "macan"]);
  assert.ok(r.body.clubs.every(c => !("adminPinHash" in c) && !("adminPin" in c)), "hash PIN tidak boleh terkirim");
  const G = await w.login("garuda", "pin-garuda-1", "1.1.1.1");
  const g = await w.call("GET", "/api/all", { headers: G });
  assert.equal(g.body.club.id, "garuda");
  assert.ok(!("clubs" in g.body));
});

test("token klub A tidak bisa dipakai menyamar jadi klub B lewat header X-Target-Club", opt, async () => {
  const { call, G } = await twoClubs();
  await call("PUT", "/api/docs/students/m-1", { headers: { ...G, "X-Target-Club": "macan" }, body: { n: "x" } });
  const b = await call("GET", "/api/all", { headers: G });
  assert.equal(b.body.club.id, "garuda");
});

test("/api/coach tanpa login tidak membocorkan daftar klub", opt, async () => {
  const w = await world();
  const r = await w.call("GET", "/api/coach");
  assert.equal(r.body.needsClub, true);
  assert.ok(!("clubs" in r.body), "daftar klub tidak boleh tampil");
  assert.ok(!/Garuda|Macan/.test(r.text));
});

test("pembatas login atomik: 30 percobaan paralel salah dari satu IP → maksimal 10 yang diproses", opt, async () => {
  const w = await world();
  const rs = await Promise.all(Array.from({ length: 30 }, () =>
    w.call("POST", "/api/login", { body: { user: "garuda", pin: "tebakan-salah" }, ip: "7.7.7.7" })));
  const diproses = rs.filter(r => r.status === 403).length;
  const diblokir = rs.filter(r => r.status === 429).length;
  assert.equal(diproses, 10);
  assert.equal(diblokir, 20);
  // PIN benar pun ditolak sementara IP itu diblokir; IP lain tidak terpengaruh
  assert.equal((await w.call("POST", "/api/login", { body: { user: "garuda", pin: "pin-garuda-1" }, ip: "7.7.7.7" })).status, 429);
  assert.equal((await w.call("POST", "/api/login", { body: { user: "garuda", pin: "pin-garuda-1" }, ip: "8.8.8.8" })).status, 200);
});

test("login berhasil menghapus hitungan salah", opt, async () => {
  const w = await world();
  for (let i = 0; i < 5; i++) await w.call("POST", "/api/login", { body: { user: "garuda", pin: "salah" }, ip: "5.5.5.5" });
  assert.equal((await w.call("POST", "/api/login", { body: { user: "garuda", pin: "pin-garuda-1" }, ip: "5.5.5.5" })).status, 200);
  const sisa = w.dbRow("staff_rl", "adm:5.5.5.5");
  assert.equal(sisa, null);
});

test("jalur login lama (header PIN) aktif secara bawaan, dan mati bila DISABLE_LEGACY_AUTH=1", opt, async () => {
  const hdr = { "X-Dojang-User": "garuda", "X-Dojang-Pin": "pin-garuda-1" };
  const on = await world();
  assert.equal((await on.call("GET", "/api/all", { headers: hdr })).status, 200);
  const off = await world({ DISABLE_LEGACY_AUTH: "1" });
  assert.equal((await off.call("GET", "/api/all", { headers: hdr })).status, 401);
  // token tetap berfungsi
  const T = await off.login("garuda", "pin-garuda-1");
  assert.equal((await off.call("GET", "/api/all", { headers: T })).status, 200);
});

test("mengganti PIN klub membatalkan token lama", opt, async () => {
  const { call, put, env, G } = await twoClubs();
  const { hashPin } = await import("../functions/api/_auth.js");
  put("clubs", "garuda", { name: "Garuda", adminUser: "garuda", adminPinHash: await hashPin("pin-baru-9"), plan: "Pro", expiresAt: "2099-01-01" });
  assert.equal((await call("GET", "/api/all", { headers: G })).status, 401);
});

test("klub kedaluwarsa/ditangguhkan ditolak (402)", opt, async () => {
  const w = await world();
  const G = await w.login("garuda", "pin-garuda-1");
  const { hashPin } = await import("../functions/api/_auth.js");
  w.put("clubs", "garuda", { name: "Garuda", adminUser: "garuda", adminPinHash: (w.dbRow("clubs", "garuda")).adminPinHash, status: "suspended" });
  assert.equal((await w.call("GET", "/api/all", { headers: G })).status, 402);
});
