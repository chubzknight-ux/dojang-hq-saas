// Unit test: naik kelas murid unit sekolah (index.html) dan pembatasan unit pelatih untuk murid di 2 unit (functions/api/staff.js).
// Jalankan: node --test
// Logika naik kelas diambil langsung dari index.html (blok ==KELAS-START== ... ==KELAS-END==).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/\/\/ ==KELAS-START==[\s\S]*?\/\/ ==KELAS-END==/);
assert.ok(m, "blok KELAS tidak ditemukan di index.html");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[0] + "\nthis.K={klsNext,KLS_LULUS};", ctx);
const { klsNext, KLS_LULUS } = ctx.K;

test("kelas angka naik satu, huruf rombel tetap", () => {
  assert.equal(klsNext("4A", 6), "5A");
  assert.equal(klsNext("Kelas 1", 6), "Kelas 2");
  assert.equal(klsNext("5 B", 6), "6 B");
  assert.equal(klsNext("10-2", 12), "11-2");
  assert.equal(klsNext("7.3", 9), "8.3");
});

test("kelas romawi kapital naik satu", () => {
  assert.equal(klsNext("IV", 6), "V");
  assert.equal(klsNext("IV-B", 6), "V-B");
  assert.equal(klsNext("VIII A", 9), "IX A");
  assert.equal(klsNext("XI IPA 1", 12), "XII IPA 1");   // romawi di depan, nomor rombel tidak ikut naik
});

test("kelas tertinggi menjadi Lulus", () => {
  assert.equal(klsNext("6B", 6), KLS_LULUS);
  assert.equal(klsNext("VI", 6), KLS_LULUS);
  assert.equal(klsNext("9A", 9), KLS_LULUS);
  assert.equal(klsNext("XII IPS 2", 12), KLS_LULUS);
});

test("isian yang tidak dikenali dibiarkan", () => {
  assert.equal(klsNext("", 6), null);
  assert.equal(klsNext("Lulus", 6), null);
  assert.equal(klsNext("Mawar", 6), null);
  assert.equal(klsNext("Kelas Ceria", 6), null);   // huruf romawi di dalam kata tidak dianggap kelas
});

test("pelatih unit tertentu ikut melihat murid yang berlatih juga di unitnya", async () => {
  const { unitScope } = await import(pathToFileURL(path.join(__dirname, "..", "functions", "api", "staff.js")).href);
  const rows = [
    { id: "a", data: { unit: "Utama" } },
    { id: "b", data: { unit: "Cabang Timur", unit2: ["Utama"] } },
    { id: "c", data: { unit: "Cabang Timur" } },
    { id: "d", data: {} },                                   // tanpa unit = Utama
    { id: "e", data: { unit: "SD Harapan", unit2: "Utama" } }  // data rusak (bukan array) diabaikan
  ];
  const s = unitScope({ units: [" utama "] }, rows);
  assert.deepEqual([...s.ids].sort(), ["a", "b", "d"]);
  assert.deepEqual([...unitScope({ units: ["Cabang Timur"] }, rows).ids].sort(), ["b", "c"]);
  assert.equal(unitScope({ units: [] }, rows), null);       // tanpa batas unit = semua murid
});
