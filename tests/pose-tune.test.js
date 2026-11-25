// Unit test penyetelan otomatis (Log Teknis): penyandian log, simulasi ulang, dan pencarian ambang.
// Jalankan: node --test tests/
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
vm.runInContext(m[0] + "\nthis.G={PG,PG_DEF,PG_BOUNDS,poseCfgApply,poseEnc,poseDec,poseSimSub,poseTune};", ctx);
const { PG, PG_DEF, PG_BOUNDS, poseCfgApply, poseEnc, poseDec, poseSimSub, poseTune } = ctx.G;

const W = 640, H = 360;
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
// Orang berdiri (landscape), visibility titik = vis ± jitter
function person(vis, jit = 0.12) {
  const P = { 0: [.5, .25], 11: [.53, .35], 12: [.47, .35], 13: [.55, .45], 14: [.45, .45], 15: [.55, .52], 16: [.45, .52], 23: [.52, .55], 24: [.48, .55], 25: [.53, .7], 26: [.47, .7], 27: [.53, .85], 28: [.47, .85] };
  return Array.from({ length: 33 }, (_, i) => {
    const q = P[i] || [.5, .25];
    return { x: q[0], y: q[1], visibility: Math.max(0, Math.min(1, vis + (rnd() - 0.5) * 2 * jit)) };
  });
}
const sub = (mk, n = 120) => ({ w: W, h: H, view: "auto", dt: 0.125, fr: Array.from({ length: n }, () => poseEnc(mk())) });
const upperOnly = () => { const L = person(0.9, 0.05); [25, 26, 27, 28].forEach(i => { L[i].visibility = 0.05; }); return L; };

test("log titik tubuh: disandikan lalu dibaca ulang dengan presisi cukup", () => {
  const L = person(0.8, 0);
  const s = poseEnc(L), D = poseDec(s);
  assert.equal(s.length, 13 * 8);
  for (const i of [0, 11, 12, 23, 24, 27, 28]) {
    assert.ok(Math.abs(D[i].x - L[i].x) < 0.002 && Math.abs(D[i].y - L[i].y) < 0.002);
    assert.ok(Math.abs(D[i].visibility - L[i].visibility) < 0.011);
  }
  assert.equal(poseEnc(null), "");
  assert.equal(poseDec(""), null);
});

test("ambang dari server selalu dijepit ke batas aman", () => {
  const saved = { ...PG };
  const o = poseCfgApply({ meanV: 0.1, confN: 99, minTorsoH: "x" });
  assert.equal(o.meanV, PG_BOUNDS.meanV[0]);
  assert.equal(o.confN, PG_BOUNDS.confN[1]);
  assert.equal(o.minTorsoH, PG_DEF.minTorsoH);
  Object.assign(PG, saved);
});

test("video tajam: tidak ada yang perlu diubah", () => {
  const subs = Array.from({ length: 6 }, () => sub(() => person(0.92, 0.05)));
  const r = poseTune(subs, {}, 0);
  assert.equal(r.before.pass, 6);
  for (const k of Object.keys(PG_BOUNDS)) assert.equal(r.pg[k], PG_DEF[k], k);
});

test("video agak buram: ambang dilonggarkan secukupnya, lebih banyak analisa lolos, tetap dalam batas aman", () => {
  const subs = Array.from({ length: 8 }, () => sub(() => person(0.6, 0.12)));
  const r = poseTune(subs, {}, 0);
  assert.ok(r.after.pass > r.before.pass, `lolos ${r.before.pass} -> ${r.after.pass}`);
  for (const k of Object.keys(PG_BOUNDS)) {
    assert.ok(r.pg[k] >= PG_BOUNDS[k][0] - 1e-9 && r.pg[k] <= PG_BOUNDS[k][1] + 1e-9, k);
  }
  assert.deepEqual({ ...PG }, { ...PG, ...PG_DEF, legVBack: PG.legVBack, coreVBack: PG.coreVBack }); // PG dikembalikan
});

test("kerangka di benda (tubuh atas saja) tetap ditolak di setelan paling longgar yang diizinkan", () => {
  const saved = { ...PG };
  const loosest = {}; for (const k of Object.keys(PG_BOUNDS)) loosest[k] = PG_BOUNDS[k][0];
  poseCfgApply(loosest);
  assert.equal(poseSimSub(sub(upperOnly)), 0);
  Object.assign(PG, saved);
  // dan log berisi kerangka di benda tidak membuat penyetel melonggarkan apa pun
  const r = poseTune(Array.from({ length: 6 }, () => sub(upperOnly)), {}, 0);
  for (const k of Object.keys(PG_BOUNDS)) assert.equal(r.pg[k], PG_DEF[k], k);
});

test("ada laporan kerangka di benda: ambang dikencangkan kembali ke arah bawaan, tidak dilonggarkan", () => {
  const cur = { meanV: 0.55, confN: 6, coreV: 0.45 };
  const subs = Array.from({ length: 6 }, () => sub(() => person(0.6, 0.12)));
  const r = poseTune(subs, cur, 2);
  assert.equal(r.mode, "tighten");
  assert.ok(Math.abs(r.pg.meanV - 0.575) < 1e-9);
  assert.equal(r.pg.confN, 7);
  assert.ok(Math.abs(r.pg.coreV - 0.475) < 1e-9);
  for (const k of Object.keys(PG_BOUNDS)) assert.ok(r.pg[k] >= (k in cur ? cur[k] : PG_DEF[k]) - 1e-9, k);
});
