// Unit test: pencocokan nama pelatih mirip dan deteksi jadwal bentrok (index.html, blok ==COACH-START== ... ==COACH-END==).
// Jalankan: node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/\/\/ ==COACH-START==[\s\S]*?\/\/ ==COACH-END==/);
assert.ok(m, "blok COACH tidak ditemukan di index.html");
const dayRx = html.match(/const DAY_RX=.*;/);
assert.ok(dayRx, "DAY_RX tidak ditemukan di index.html");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(dayRx[0] + "\n" + m[0] + "\nthis.K={normN,clsSlots,clsClash};", ctx);
const { normN, clsSlots, clsClash } = ctx.K;

test("gelar di depan nama diabaikan saat mencocokkan", () => {
  assert.equal(normN("Sabeum Shandy"), normN("Shandy"));
  assert.equal(normN("Master Juwono"), normN("juwono"));
  assert.equal(normN("Coach  Jeffry"), "jeffry");
  assert.notEqual(normN("Sabeum Andi"), normN("Sabeum Budi"));
});

test("hari dan jam jadwal terbaca", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(clsSlots({ h: "Senin", j: "12.45-13.15" }))), { days: [1], st: 765, en: 795 });
  assert.deepEqual(Array.from(clsSlots({ h: "Selasa, Kamis", j: "18.00 – 20.00" }).days).sort(), [2, 4]);
  assert.equal(clsSlots({ h: "", j: "18.00" }), null);
  assert.equal(clsSlots({ h: "Senin", j: "" }), null);
});

test("jadwal bentrok hanya bila hari sama dan jam beririsan", () => {
  const a = { h: "Senin", j: "12.45-13.15" };
  assert.equal(clsClash(a, { h: "Senin", j: "13.00-14.00" }), true);
  assert.equal(clsClash(a, { h: "Senin", j: "13.15-14.00" }), false);   // sambung persis, tidak bentrok
  assert.equal(clsClash(a, { h: "Selasa", j: "12.45-13.15" }), false);
  assert.equal(clsClash(a, { h: "Senin, Rabu", j: "12.00-13.00" }), true);
});
