// Unit test sintetis untuk penyaring "kerangka hantu" di Analisa Video (index.html).
// Jalankan: node --test
// Kode yang diuji diambil langsung dari index.html (blok ==POSE-GUARD-START== ... ==POSE-GUARD-END==),
// jadi tes ini selalu menguji kode yang benar-benar dipakai aplikasi.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/\/\/ ==POSE-GUARD-START==[\s\S]*?\/\/ ==POSE-GUARD-END==/);
assert.ok(m, "blok POSE-GUARD tidak ditemukan di index.html");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[0] + "\nthis.G={plausible,plausibleWhy,poseConfirmer,poseConfirmSeq,poseDiag,poseDiagAdd,kinPt,poseN,PG,KIN};", ctx);
const { plausible, plausibleWhy, poseConfirmer, poseConfirmSeq, poseDiag, poseDiagAdd, kinPt, poseN } = ctx.G;

const W = 480, H = 640; // frame portrait (piksel)

// Orang berdiri utuh menghadap kamera, tinggi badan ±75% frame (koordinat normal 0..1 seperti keluaran MediaPipe)
function standing(vis = 0.9) {
  const L = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: vis }));
  const set = (i, x, y, v = vis) => { L[i] = { x, y, z: 0, visibility: v }; };
  set(0, 0.5, 0.15);                                   // hidung
  [1, 2, 3, 4, 5, 6].forEach((i, k) => set(i, k < 3 ? 0.51 + k * 0.01 : 0.49 - (k - 3) * 0.01, 0.14)); // mata
  set(7, 0.54, 0.15); set(8, 0.46, 0.15); set(9, 0.51, 0.17); set(10, 0.49, 0.17);
  set(11, 0.58, 0.25); set(12, 0.42, 0.25);            // bahu
  set(13, 0.62, 0.38); set(14, 0.38, 0.38);            // siku
  set(15, 0.63, 0.5); set(16, 0.37, 0.5);              // pergelangan tangan
  set(17, 0.63, 0.52); set(18, 0.37, 0.52); set(19, 0.63, 0.53); set(20, 0.37, 0.53); set(21, 0.62, 0.52); set(22, 0.38, 0.52);
  set(23, 0.555, 0.5); set(24, 0.445, 0.5);            // pinggul
  set(25, 0.56, 0.68); set(26, 0.44, 0.68);            // lutut
  set(27, 0.56, 0.86); set(28, 0.44, 0.86);            // pergelangan kaki
  set(29, 0.56, 0.88); set(30, 0.44, 0.88); set(31, 0.58, 0.89); set(32, 0.42, 0.89);
  return L;
}
const transform = (L, f) => L.map(p => ({ ...p, ...f(p) }));

test("orang berdiri utuh: lolos", () => {
  assert.equal(plausible(standing(), W, H, { view: "auto" }), true);
  assert.equal(plausible(standing(), W, H, { view: "depan" }), true);
});

test("tubuh atas saja (kaki tidak terlihat, ciri khas kerangka di benda): ditolak", () => {
  const L = standing();
  [25, 26, 27, 28, 29, 30, 31, 32].forEach(i => { L[i] = { ...L[i], visibility: 0.1 }; });
  assert.equal(plausible(L, W, H, { view: "auto" }), false);
  assert.equal(plausible(L, W, H, { view: "belakang" }), false);
});

test("kerangka lengkap tapi sangat kecil: ditolak", () => {
  const L = transform(standing(), p => ({ x: 0.5 + (p.x - 0.5) * 0.15, y: 0.5 + (p.y - 0.5) * 0.15 }));
  assert.equal(plausible(L, W, H, { view: "auto" }), false);
});

test("pose terbalik (kepala di bawah): ditolak", () => {
  const L = transform(standing(), p => ({ y: 1 - p.y }));
  assert.equal(plausible(L, W, H, { view: "auto" }), false);
  assert.equal(plausible(L, W, H, { view: "belakang" }), false);
});

// --- penyesuaian Taekwondo: posisi yang sah tidak boleh ikut tertolak
test("Taekwondo: kuda-kuda menyamping (bahu tampak sangat sempit) tetap lolos", () => {
  const L = transform(standing(), p => ({ x: 0.5 + (p.x - 0.5) * 0.1 }));
  assert.equal(plausible(L, W, H, { view: "samping" }), true);
});

test("Taekwondo: badan miring ±60° saat yeop chagi tetap lolos, miring ±80° ditolak", () => {
  const lean = deg => {
    const a = deg * Math.PI / 180, cx = 0.5 * W, cy = 0.5 * H; // putar badan atas di sekitar pinggul
    return standing().map((p, i) => {
      if (i > 22) return p;
      const x = p.x * W - cx, y = p.y * H - cy;
      return { ...p, x: (cx + x * Math.cos(a) - y * Math.sin(a)) / W, y: (cy + x * Math.sin(a) + y * Math.cos(a)) / H };
    });
  };
  assert.equal(plausible(lean(60), W, H, { view: "auto" }), true);
  assert.equal(plausible(lean(80), W, H, { view: "auto" }), false);
});

test("kamera dari belakang badan (hidung tidak terlihat): lolos bila kedua kaki lengkap", () => {
  const L = standing();
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(i => { L[i] = { ...L[i], visibility: 0.1 }; });
  assert.equal(plausible(L, W, H, { view: "belakang" }), true);
  assert.equal(plausible(L, W, H, { view: "auto" }), true);
  assert.equal(plausible(L, W, H, { view: "depan" }), false); // dipilih "Depan" tapi wajah tidak terlihat
  L[27] = { ...L[27], visibility: 0.1 };                       // dari belakang wajib dua kaki lengkap
  assert.equal(plausible(L, W, H, { view: "belakang" }), false);
});

test("lengan terlalu panjang (titik tangan melompat ke benda di sebelah): ditolak", () => {
  const L = standing();
  L[15] = { ...L[15], x: 0.98, y: 0.95 };
  assert.equal(plausible(L, W, H, { view: "auto" }), false);
});

// --- lapis 2: konfirmasi temporal
test("konfirmasi: sah setelah 8 frame berturut-turut, bukan sebelumnya", () => {
  const c = poseConfirmer(), out = [];
  for (let i = 0; i < 10; i++) out.push(c.step(i * 0.1, true));
  assert.deepEqual(out, [false, false, false, false, false, false, false, true, true, true]);
});

test("konfirmasi: jeda > 500 ms atau frame gagal mengulang hitungan ke 1", () => {
  const c = poseConfirmer();
  for (let i = 0; i < 7; i++) c.step(i * 0.1, true);
  assert.equal(c.step(0.6 + 0.6, true), false); // jeda 600 ms: hitungan kembali 1
  let t = 1.2;
  for (let i = 0; i < 6; i++) { t += 0.1; c.step(t, true); }
  assert.equal(c.confirmed, false);             // baru 7 frame
  c.step(t + 0.05, false);                       // satu frame gagal memutus rangkaian
  for (let i = 1; i <= 7; i++) c.step(t + 0.05 + i * 0.1, true);
  assert.equal(c.confirmed, false);
  assert.equal(c.step(t + 0.05 + 0.8, true), true);
});

test("konfirmasi: hilang > 1.2 dtk harus dikonfirmasi ulang; hilang sebentar tidak", () => {
  const fr = [];
  for (let i = 0; i < 10; i++) fr.push({ t: i * 0.1, p: {} });
  for (let i = 0; i < 5; i++) fr.push({ t: 1 + i * 0.2, p: null }); // hilang 1.0 dtk
  fr.push({ t: 2.0, p: {} });                                         // kembali: masih sah
  for (let i = 1; i <= 7; i++) fr.push({ t: 2.0 + i * 0.25, p: null }); // hilang 1.75 dtk
  for (let i = 0; i < 9; i++) fr.push({ t: 4.0 + i * 0.1, p: {} });
  const ok = poseConfirmSeq(fr).map(f => !!f.p);
  assert.equal(ok[9], true);
  assert.equal(ok[15], true);
  assert.deepEqual(ok.slice(23), [false, false, false, false, false, false, false, true, true]);
});

// --- lapis 3: gerbang kinematik
test("gerbang kinematik: pergelangan > 0.5 dan siku/lutut > 0.4", () => {
  const p = [];
  p[15] = { x: 0, y: 0, v: 0.6 }; p[13] = { x: 0, y: 0, v: 0.45 };
  assert.ok(kinPt(p, 15, false));
  p[13].v = 0.35;
  assert.equal(kinPt(p, 15, false), null);
  p[27] = { x: 0, y: 0, v: 0.5 }; p[25] = { x: 0, y: 0, v: 0.9 };
  assert.equal(kinPt(p, 27, false), null);
});

test("sampling video: jeda antar frame selalu < 500 ms (video 5 menit pun)", () => {
  for (const dur of [5, 30, 60, 120, 300]) {
    const n = poseN(dur);
    assert.ok(dur * 0.98 / (n - 1) < 0.5, `dur ${dur}: n ${n}`);
  }
  assert.equal(poseN(10), 80); // video pendek tidak berubah dari sebelumnya (8 frame/dtk)
});

// --- penyebab ditolak (dipakai untuk pesan "kenapa gagal terbaca")
test("penyebab ditolak: buram/visibility rendah, terlalu kecil, kaki tidak utuh, posisi tidak wajar", () => {
  assert.equal(plausibleWhy(standing(), W, H, { view: "auto" }), "");
  assert.equal(plausibleWhy(standing(0.4), W, H, { view: "auto" }), "vis");
  assert.equal(plausibleWhy(transform(standing(), p => ({ x: 0.5 + (p.x - 0.5) * 0.15, y: 0.5 + (p.y - 0.5) * 0.15 })), W, H, { view: "auto" }), "small");
  const noLegs = standing(); [25, 26, 27, 28].forEach(i => { noLegs[i] = { ...noLegs[i], visibility: 0.45 }; });
  assert.equal(plausibleWhy(noLegs, W, H, { view: "auto" }), "legs");
  assert.equal(plausibleWhy(transform(standing(), p => ({ y: 1 - p.y })), W, H, { view: "auto" }), "pose");
});

test("catatan per video: menghitung frame terbaca dan penyebab utama penolakan", () => {
  const dg = poseDiag();
  poseDiagAdd(dg, [standing()], W, H, { view: "auto" });
  poseDiagAdd(dg, [], W, H, { view: "auto" });
  poseDiagAdd(dg, [standing(0.4)], W, H, { view: "auto" });
  poseDiagAdd(dg, [standing(0.4), standing()], W, H, { view: "auto" }); // satu orang lolos = frame terbaca
  assert.deepEqual(JSON.parse(JSON.stringify(dg)), { n: 4, none: 1, ok: 2, rej: { vis: 1, small: 0, legs: 0, pose: 0 } });
});

test("video unggahan: 8 frame yang mengesahkan subjek ikut dipakai (retro); kamera live tidak", () => {
  const fr = []; for (let i = 0; i < 10; i++) fr.push({ t: i * 0.125, p: {} });
  assert.equal(poseConfirmSeq(fr).filter(f => f.p).length, 3);
  assert.equal(poseConfirmSeq(fr, true).filter(f => f.p).length, 10);
  const short = []; for (let i = 0; i < 7; i++) short.push({ t: i * 0.125, p: {} }); // tidak pernah sah
  assert.equal(poseConfirmSeq(short, true).filter(f => f.p).length, 0);
});

test("konfirmasi kamera live di HP lambat: jeda yang lebih panjang boleh diberikan pemanggil", () => {
  const slow = poseConfirmer(), strict = poseConfirmer();
  const outS = [], outD = [];
  for (let i = 0; i < 9; i++) { outS.push(slow.step(i * 0.9, true, 2.25, 2.7)); outD.push(strict.step(i * 0.9, true)); }
  assert.deepEqual(outS, [false, false, false, false, false, false, false, true, true]); // 1.1 frame/dtk tetap bisa sah
  assert.equal(outD.some(Boolean), false); // dengan jeda 0.5 dtk tidak pernah sah
});
