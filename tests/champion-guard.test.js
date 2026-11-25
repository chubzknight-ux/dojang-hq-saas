// Unit test sintetis untuk penyaring "kerangka hantu" di Champion (champion.html).
// Jalankan: node --test
// Kode diambil langsung dari champion.html (blok ==CHAMP-GUARD-START== ... ==CHAMP-GUARD-END==).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "champion.html"), "utf8");
const m = html.match(/\/\* ==CHAMP-GUARD-START==[\s\S]*?==CHAMP-GUARD-END== \*\//);
assert.ok(m, "blok CHAMP-GUARD tidak ditemukan di champion.html");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[0] + "\nthis.G={champOk,champConfirmer,champKin,champTor,CG};", ctx);
const { champOk, champConfirmer, champKin } = ctx.G;

// Membuat 33 landmark dari peta {indeks:[x,y,vis]}; titik lain ikut hidung dengan visibility rendah
function mk(map, fill = 0.2) {
  const n = map[0] || [0.5, 0.5, 0.9];
  return Array.from({ length: 33 }, (_, i) => {
    const q = map[i] || [n[0], n[1], fill];
    return { x: q[0], y: q[1], z: 0, visibility: q[2] };
  });
}
const PORTRAIT = [480, 640], LAND = [1280, 720];

// Berdiri tegak menghadap kamera (HP di depan, portrait)
const standing = () => mk({
  0: [0.5, 0.15, 0.9], 11: [0.58, 0.25, 0.9], 12: [0.42, 0.25, 0.9], 13: [0.62, 0.38, 0.9], 14: [0.38, 0.38, 0.9],
  15: [0.63, 0.5, 0.9], 16: [0.37, 0.5, 0.9], 23: [0.555, 0.5, 0.9], 24: [0.445, 0.5, 0.9],
  25: [0.56, 0.68, 0.9], 26: [0.44, 0.68, 0.9], 27: [0.56, 0.86, 0.9], 28: [0.44, 0.86, 0.9]
});
// Plank dilihat dari samping (landscape): badan mendatar, sisi jauh tertutup (visibility rendah)
const plank = () => mk({
  0: [0.2, 0.58, 0.8], 11: [0.28, 0.6, 0.9], 13: [0.28, 0.75, 0.9], 15: [0.36, 0.76, 0.9], 23: [0.5, 0.62, 0.9], 25: [0.66, 0.63, 0.9], 27: [0.82, 0.64, 0.9],
  12: [0.28, 0.6, 0.3], 14: [0.28, 0.75, 0.3], 16: [0.36, 0.76, 0.3], 24: [0.5, 0.62, 0.3], 26: [0.66, 0.63, 0.3], 28: [0.82, 0.64, 0.3]
});
// Glute bridge dari samping: bahu di lantai, pinggul terangkat lebih tinggi dari bahu
const bridge = () => mk({
  0: [0.22, 0.7, 0.8], 11: [0.3, 0.7, 0.9], 13: [0.36, 0.76, 0.8], 15: [0.45, 0.78, 0.8], 23: [0.5, 0.55, 0.9], 25: [0.65, 0.5, 0.9], 27: [0.68, 0.74, 0.9],
  12: [0.3, 0.7, 0.3], 14: [0.36, 0.76, 0.3], 16: [0.45, 0.78, 0.3], 24: [0.5, 0.55, 0.3], 26: [0.65, 0.5, 0.3], 28: [0.68, 0.74, 0.3]
});
// Kupu-kupu: duduk tegak menghadap kamera, telapak kaki menempel, lutut ke samping (thr latihan 0.4)
const kupu = () => mk({
  0: [0.5, 0.2, 0.9], 11: [0.6, 0.33, 0.9], 12: [0.4, 0.33, 0.9], 13: [0.64, 0.47, 0.8], 14: [0.36, 0.47, 0.8], 15: [0.58, 0.6, 0.7], 16: [0.42, 0.6, 0.7],
  23: [0.56, 0.62, 0.8], 24: [0.44, 0.62, 0.8], 25: [0.74, 0.66, 0.7], 26: [0.26, 0.66, 0.7], 27: [0.53, 0.7, 0.6], 28: [0.47, 0.7, 0.6]
});
const tf = (L, f) => L.map(p => ({ ...p, ...f(p) }));

test("orang berdiri utuh: lolos", () => {
  assert.equal(champOk(standing(), ...PORTRAIT, 0.5), true);
});

test("tubuh atas saja (kaki tidak terlihat, ciri khas kerangka di benda): ditolak", () => {
  const L = standing();
  [25, 26, 27, 28].forEach(i => { L[i] = { ...L[i], visibility: 0.1 }; });
  assert.equal(champOk(L, ...PORTRAIT, 0.5), false);
  assert.equal(champOk(L, ...PORTRAIT, 0.3), false);
});

test("kerangka lengkap tapi sangat kecil: ditolak", () => {
  const L = tf(standing(), p => ({ x: 0.5 + (p.x - 0.5) * 0.15, y: 0.5 + (p.y - 0.5) * 0.15 }));
  assert.equal(champOk(L, ...PORTRAIT, 0.5), false);
});

test("pose terbalik (kepala di bawah, pinggul di atas): ditolak", () => {
  assert.equal(champOk(tf(standing(), p => ({ y: 1 - p.y })), ...PORTRAIT, 0.5), false);
});

test("posisi latihan Champion yang sah tetap lolos: plank, bridge, kupu-kupu", () => {
  assert.equal(champOk(plank(), ...LAND, 0.5), true, "plank");
  assert.equal(champOk(bridge(), ...LAND, 0.5), true, "bridge");
  assert.equal(champOk(kupu(), ...PORTRAIT, 0.4), true, "kupu-kupu");
});

test("lengan terlalu panjang (titik tangan melompat ke benda di sebelah): ditolak", () => {
  const L = standing();
  L[15] = { ...L[15], x: 0.98, y: 0.98 };
  assert.equal(champOk(L, ...PORTRAIT, 0.5), false);
});

test("kepala terlepas dari badan (hidung jauh dari bahu): ditolak", () => {
  const L = standing();
  L[0] = { ...L[0], x: 0.9, y: 0.05 };
  assert.equal(champOk(L, ...PORTRAIT, 0.5), false);
});

test("konfirmasi: sah setelah 8 frame berturut-turut; jeda > 500 ms mengulang hitungan", () => {
  const c = champConfirmer(), out = [];
  for (let i = 0; i < 9; i++) out.push(c.step(i / 30, true));
  assert.deepEqual(out, [false, false, false, false, false, false, false, true, true]);
  const c2 = champConfirmer();
  for (let i = 0; i < 7; i++) c2.step(i / 30, true);
  assert.equal(c2.step(7 / 30 + 0.6, true), false);
});

test("konfirmasi: hilang > 1.2 dtk harus dikonfirmasi ulang", () => {
  const c = champConfirmer();
  for (let i = 0; i < 8; i++) c.step(i / 30, true);
  assert.equal(c.confirmed, true);
  assert.equal(c.step(1.0, false), false);
  assert.equal(c.confirmed, true);          // hilang < 1.2 dtk: masih sah
  assert.equal(c.step(1.5, true), false);   // hilang 1.27 dtk: mulai dari awal
  assert.equal(c.confirmed, false);
});

// --- gerbang kinematik
const px = (L, W, H) => L.map(p => ({ x: p.x * W, y: p.y * H, v: p.visibility }));
const ids = [11, 12, 23, 24, 25, 26, 27, 28];

test("gerbang kinematik: loncatan > 80 torso/dtk dibuang", () => {
  const k = champKin(ids, 0.5);
  const A = px(standing(), ...PORTRAIT);
  k.track(A, 0);
  const B = A.map((p, i) => (i === 27 ? { ...p, x: p.x + 500 } : p)); // 500 px dalam 1/30 dtk, torso 160 px = 94 torso/dtk
  assert.equal(k.jump(B, 1 / 30), true);
  const C = A.map((p, i) => (i === 27 ? { ...p, x: p.x + 10 } : p));
  assert.equal(k.jump(C, 1 / 30), false);
});

test("gerbang kinematik: getaran di tempat tidak dihitung sebagai gerakan, squat nyata dihitung", () => {
  const A = px(standing(), ...PORTRAIT);
  const k = champKin(ids, 0.5);
  for (let i = 0; i < 30; i++) k.track(A.map(p => ({ ...p, x: p.x + (i % 2 ? 4 : -4), y: p.y + (i % 2 ? -4 : 4) })), i / 30);
  assert.equal(k.rep(A), false);            // getar ±4 px (0.05 torso)
  for (let i = 0; i < 30; i++) {
    const dip = Math.sin(i / 29 * Math.PI) * 50; // pinggul turun ±0.3 torso
    k.track(A.map((p, j) => ([11, 12, 23, 24].includes(j) ? { ...p, y: p.y + dip } : p)), 1 + i / 30);
  }
  assert.equal(k.rep(A), true);
});
