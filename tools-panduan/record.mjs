// Merekam video panduan.  Pakai:
//   node --experimental-sqlite server.mjs <repo> <hq|saas> 8788 &
//   NODE_PATH=$(npm root -g) node record.mjs <hq|saas> 8788 <folder-keluar> [nama-skenario...]
import { chromium, newRec, cap, nocap, tap, typeIn, finish, sleep, smoothScroll } from "./rec.mjs";
import { seedSaas, seedHq, seedPr, ensureBilling, makeClaimedInvoice } from "./seed.mjs";

const [variant = "saas", port = "8788", outDir = "./out", ...only] = process.argv.slice(2);
const base = "http://localhost:" + port, SAAS = variant === "saas";
const seed = await (SAAS ? seedSaas : seedHq)(base);
await seedPr(base, seed.H);
const adminInit = SAAS ? { dojang_atok: seed.token, dojang_gate: "admin" } : { dojang_pin: seed.token, dojang_last_act: String(Date.now()) };
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const D = { w: 1000, h: 640, dir: outDir + "/_tmp" };
const M = { w: 390, h: 780, dir: outDir + "/_tmp", cs: "15px" };
const S = {};
const NAV = v => `nav button[data-v=${v}]`;
// pindah menu lalu kembali ke atas halaman (menu kiri panjang bisa ikut menggulir halaman)
const go = async (p, v, after = 900) => { await tap(p, NAV(v), { after: 250 }); await p.evaluate(() => scrollTo(0, 0)); await sleep(after); };

// 1) Masuk & Dashboard
S["01-masuk-dan-dashboard"] = async () => {
  const rc = await newRec(browser, { ...D });
  const p = rc.page;
  await p.goto(base + "/"); await sleep(700);
  await cap(p, "Buka alamat aplikasi dojang Anda. Layar pembuka muncul sebentar saat memuat.", "LANGKAH 1", 2600);
  await p.waitForSelector("#pinInp");
  await cap(p, SAAS ? "Pilih tab “Kepala Pelatih / Admin”, lalu isi nama pengguna dan PIN" : "Pilih tab “Admin”, lalu ketik PIN admin", "LANGKAH 2", 1900);
  if (SAAS) await typeIn(p, "#usrInp", "garuda");
  await typeIn(p, "#pinInp", SAAS ? "demo1234" : "demo-pin-2026");
  await tap(p, "#pinBtn", { after: 1800 });
  await p.waitForSelector(NAV("dash"));
  await cap(p, "Dashboard: jumlah murid, kehadiran terakhir, iuran bulan ini, dan jadwal kelas berikutnya", "LANGKAH 3", 3600);
  await cap(p, "Titik hijau di kiri atas = data tersinkron. Kuning = sedang offline (absensi & iuran tetap aman, dikirim nanti)", null, 3800);
  await cap(p, "Tombol “✅ Absen kelas ini” langsung membuka absensi untuk kelas hari ini", null, 3200);
  await cap(p, "Kartu angka bisa diketuk, mis. “Iuran belum lunas” langsung membuka daftar yang belum bayar", null, 3600);
  await smoothScroll(p, 520, 1800);
  await cap(p, "Gulir ke bawah untuk melihat sebaran sabuk dan grafik kehadiran", null, 3000);
  await smoothScroll(p, -520, 1000);
  await cap(p, "Punya beberapa cabang? Pilih unit di kiri atas (di HP: di bar paling atas layar)", "LANGKAH 4", 2600);
  await p.selectOption("#unitSel", { label: /Cabang Timur/ }).catch(async () => { await p.selectOption("#unitSel", "Cabang Timur").catch(() => {}); });
  await sleep(1800);
  await cap(p, "Menu di kiri dikelompokkan: Harian, Progres murid, Keuangan, Klub, Sistem. Di HP: bar bawah + “Lainnya”. Selesai! 🎉", null, 4200);
  return rc;
};

// 2) Murid & Absensi
S["02-murid-dan-absensi"] = async () => {
  const rc = await newRec(browser, { ...D, init: adminInit });
  const p = rc.page;
  await p.goto(base + "/"); await p.waitForSelector(NAV("mur")); await sleep(900);
  await go(p, "mur", 900);
  await cap(p, "Menu Murid: daftar semua murid beserta sabuk dan unitnya", "MURID", 2600);
  await typeIn(p, "#fSearchInp", "alya"); await cap(p, "Cari murid dengan mengetik namanya", null, 1800);
  await p.fill("#fSearchInp", ""); await p.dispatchEvent("#fSearchInp", "input"); await sleep(500);
  await tap(p, "button[data-a=add]", { after: 700 });
  await cap(p, "Tekan “Tambah murid”, lalu isi datanya", null, 2000);
  await typeIn(p, "#fn", "Citra Maharani", { delay: 60 });
  await p.selectOption("#fgender", { index: 2 }).catch(() => {}); await sleep(500);
  await typeIn(p, "#fortu", "Ibu Dewi", { delay: 60 });
  await typeIn(p, "#fu", "Utama", { delay: 60 });
  await typeIn(p, "#fw", "081234567890", { delay: 50 });
  await cap(p, "Nomor WhatsApp orang tua dipakai untuk menyalin pesan tagihan & laporan", null, 2600);
  await tap(p, "button[data-a=save]", { after: 1400 });
  await cap(p, "Murid tersimpan. Ketuk nama murid untuk membuka laporannya", null, 3000);
  await tap(p, "details.rmenu > summary", { after: 700 });
  await cap(p, "Tombol ⋯ berisi: laporan, salin link Portal orang tua, link Champion (latihan PR), dan hapus", null, 4000);
  await tap(p, "h1", { after: 500 });
  await go(p, "abs", 900);
  await cap(p, "Menu Absensi: pilih tanggal, lalu ketuk murid yang hadir (seluruh baris bisa diketuk)", "ABSENSI", 3400);
  for (const i of [0, 1, 2, 4]) await tap(p, "label.row[data-srow]", { nth: i, after: 450 });
  await cap(p, "Jumlah hadir terlihat di bar bawah. Tersimpan otomatis, tanpa sinyal pun aman", null, 3600);
  await tap(p, ".segtabs button[data-val=rekap]", { after: 900 });
  await cap(p, "Tab “Rekap bulanan”: kehadiran tiap murid sebulan penuh", null, 2800);
  await tap(p, "button[data-a=copyAttRep]", { after: 700 });
  await cap(p, "“Salin Ringkasan WA” membuat rekap kehadiran siap kirim ke grup", null, 2800);
  return rc;
};

// 3) Iuran, Pengumuman, Ringkasan bulanan
S["03-iuran-pengumuman-ringkasan"] = async () => {
  const rc = await newRec(browser, { ...D, init: adminInit });
  const p = rc.page;
  await p.goto(base + "/"); await p.waitForSelector(NAV("iur")); await sleep(900);
  await go(p, "iur", 900);
  await cap(p, "Menu Iuran: tabel pembayaran per murid per bulan", "IURAN", 2800);
  const cb = p.locator("#app input[type=checkbox]");
  for (const i of [0, 1, 3]) await tap(p, "#app input[type=checkbox]", { nth: i, after: 500 }).catch(() => {});
  await cap(p, "Centang murid yang sudah membayar. Tarif diatur per unit di menu Jadwal & Unit", null, 3400);
  await tap(p, ".segtabs button[data-val=unpaid]", { after: 900 });
  await cap(p, "Filter “Belum lunas” menampilkan yang belum bayar. Tombol “Ingatkan” menyiapkan pesan WhatsApp", null, 3800);
  await tap(p, ".segtabs button[data-val=all]", { after: 500 });
  await go(p, "umum", 900);
  await cap(p, "Menu Pengumuman: kabar untuk orang tua dan pelatih", "PENGUMUMAN", 2800);
  await typeIn(p, "#umJudul", "Libur latihan 25 Desember", { delay: 55 });
  await typeIn(p, "#app textarea", "Latihan libur Natal. Latihan lagi hari Sabtu 27 Desember pukul 08.00.", { delay: 35 });
  await p.fill("#umMulai", "2026-11-22"); await p.fill("#umSampai", "2026-12-31"); await sleep(700);
  await cap(p, "Atur tanggal tayang dan unit tujuan (semua unit atau satu unit)", null, 2600);
  await tap(p, "button[data-a=umSave]", { after: 900 });
  await p.evaluate(() => scrollTo({ top: 0, behavior: "smooth" })); await sleep(900);
  await cap(p, "Pengumuman tampil di Dashboard dan Portal Orang Tua sesuai tanggal tayang", null, 3200);
  await go(p, "rkp", 1000);
  await cap(p, "Ringkasan bulanan: murid baru, iuran masuk, kehadiran per unit, dan naik sabuk", "RINGKASAN", 3600);
  await tap(p, "button[data-a=rkpCopy]", { after: 700 });
  await cap(p, "Salin untuk WhatsApp atau unduh CSV. Hanya Admin yang melihatnya karena memuat iuran", null, 3200);
  return rc;
};

// 4) Portal Orang Tua
S["04-portal-orang-tua"] = async () => {
  const rc = await newRec(browser, { ...M });
  const p = rc.page;
  await p.goto(base + "/?portal=alya-putri" + (SAAS ? "&club=garuda" : "")); await p.waitForSelector("#pvName"); await sleep(600);
  await cap(p, "Orang tua membuka tautan Portal yang dikirim dari menu Murid (⋯ → Salin link Portal)", "PORTAL ORANG TUA", 3200);
  await typeIn(p, "#pvName", "Alya", { delay: 110 });
  await cap(p, "Demi keamanan, cukup ketik nama anak. Hanya sekali per HP", null, 2600);
  await tap(p, "#pvBtn", { after: 2200 });
  await p.waitForSelector(".hero");
  await cap(p, "Terbuka! Progres sabuk, kehadiran, dan skor latihan anak", null, 3000);
  await smoothScroll(p, 520, 1700); await cap(p, "Nilai keterampilan dan catatan dari pelatih", null, 2600);
  await smoothScroll(p, 560, 1700); await cap(p, "Status iuran, jadwal kelas, dan pengumuman dari dojang", null, 2800);
  await smoothScroll(p, 600, 1700); await sleep(1200);
  await smoothScroll(p, -1500, 2200);
  await cap(p, "Tombol 🏆 Champion membuka latihan PR di rumah untuk anak", null, 3200);
  return rc;
};

// 5) Champion: pelatih mengatur PR, lalu anak berlatih
S["05-champion"] = async () => {
  const rc = await newRec(browser, { ...M, init: adminInit });
  const p = rc.page;
  await p.goto(base + "/champion?pelatih=1"); await p.waitForSelector("#gMode"); await sleep(900);
  await cap(p, "Pelatih / admin: buka menu 🏆 Champion (PR) untuk mengatur latihan di rumah", "CHAMPION · PELATIH", 3200);
  await smoothScroll(p, 330, 1200);
  await cap(p, "Lihat siapa yang sudah dan belum latihan hari ini, lalu kirim rekap ke WhatsApp", null, 3200);
  await smoothScroll(p, 520, 1400);
  await cap(p, "Pilih PR: sama untuk semua, atau 🎲 acak per anak (tiap anak dapat latihan berbeda)", null, 3600);
  await p.selectOption("#gMode", { index: 1 }).catch(() => {}); await sleep(900);
  await cap(p, "Atur jumlah latihan per anak, lalu 💾 Simpan PR dan 📢 umumkan ke orang tua", null, 3400);
  await nocap(p);
  // bagian anak
  await p.evaluate(() => { try { localStorage.removeItem("dojang_atok"); localStorage.removeItem("dojang_pin"); } catch (e) {} });
  await p.goto(base + "/champion?id=alya-putri"); await p.waitForSelector("#slName"); await sleep(700);
  await cap(p, "Anak / murid: buka tautan Champion, lalu ketik namanya sendiri", "CHAMPION · ANAK", 3000);
  await typeIn(p, "#slName", "Alya Putri", { delay: 90 });
  await tap(p, "#slGo", { after: 2500 });
  await cap(p, "Beranda Champion: bintang, hari beruntun, dan PR dari pelatih khusus untuknya", null, 3600);
  await p.screenshot({ path: outDir + "/_dbg_champ_home.png" });
  return rc;
};

// 6) Akun pelatih: admin membuat akun, pelatih masuk
S["06-akun-pelatih"] = async () => {
  const rc = await newRec(browser, { ...D, init: adminInit });
  const p = rc.page;
  await p.goto(base + "/"); await p.waitForSelector(NAV("pel")); await sleep(900);
  await go(p, "pel", 1000);
  await cap(p, "Menu Pelatih punya 3 tab: Akun, Kinerja (evaluasi orang tua), dan Nilai internal", "AKUN PELATIH", 3400);
  await p.locator("#stfName").scrollIntoViewIfNeeded(); await sleep(700);
  await cap(p, "Buat akun: isi nama, nama pengguna, dan kata sandi (min. 8 karakter, huruf + angka)", null, 3400);
  await typeIn(p, "#stfName", "Sabeum Budi", { delay: 60 });
  await typeIn(p, "#stfUser", "budi", { delay: 70 });
  await typeIn(p, "#stfPass", "Ksatria2026", { delay: 70 });
  await tap(p, "#stfPA", { after: 500 }); await tap(p, "#stfPN", { after: 500 });
  await cap(p, "Beri izin: centang Absensi dan/atau Penilaian. Tanpa izin, pelatih hanya bisa melihat", null, 3600);
  await tap(p, "button[data-a=stfSave]", { after: 1600 });
  await cap(p, "Akun dibuat. Bagikan nama pengguna & kata sandi lewat WhatsApp. Pelatih juga bisa daftar sendiri lewat tautan lalu Anda setujui", null, 4400);
  await tap(p, "#logoutBtn", { after: 1800 });
  await p.waitForSelector("button[data-gate=coach]");
  await cap(p, "Pelatih masuk lewat tab “Pelatih”", "PELATIH MASUK", 2400);
  await tap(p, "button[data-gate=coach]", { after: 600 });
  if (SAAS) await typeIn(p, "#clubInp", "garuda", { delay: 70 });
  await typeIn(p, "#usrInp", "budi", { delay: 70 });
  await typeIn(p, "#pinInp", "Ksatria2026", { delay: 70 });
  await tap(p, "#pinBtn", { after: 2400 });
  await cap(p, "Saat pertama masuk, pelatih diminta mengganti kata sandi awal dengan miliknya sendiri", null, 3600);
  await typeIn(p, 'input[placeholder^="Kata sandi lama"]', "Ksatria2026", { delay: 60 });
  await typeIn(p, 'input[placeholder^="Kata sandi baru"]', "SabukHitam88", { delay: 60 });
  await tap(p, 'button:has-text("Simpan"):visible', { after: 1800 });
  await cap(p, "Pelatih hanya melihat murid di unitnya, tanpa nomor WA atau data iuran", null, 3800);
  await go(p, "abs", 1000);
  await cap(p, "Mengisi absensi dan penilaian sesuai izin yang diberikan. Selesai! 🎉", null, 3200);
  return rc;
};

// 9) Penilaian kelas & laporan murid
S["09-penilaian-dan-laporan"] = async () => {
  const rc = await newRec(browser, { ...D, init: adminInit });
  const p = rc.page;
  await p.goto(base + "/"); await p.waitForSelector(NAV("pen")); await sleep(900);
  await go(p, "pen", 1000);
  await cap(p, "Menu Penilaian: pilih tanggal sesi dan nama pelatih penilai", "PENILAIAN", 3000);
  await p.locator(".rate").first().scrollIntoViewIfNeeded(); await sleep(600);
  await cap(p, "Nilai 5 aspek dengan sekali ketuk (1–5). Ketuk lagi angka yang sama untuk mengosongkan", null, 3600);
  const picks = [[0, 4], [1, 3], [2, 4], [3, 5], [4, 5], [5, 3], [6, 4], [7, 4], [8, 3], [9, 5]];
  for (const [g, v] of picks) await tap(p, `.rate >> nth=${g} >> button[data-segv="${v}"]`, { after: 250 });
  await typeIn(p, "[data-en] >> nth=0", "Tendangan **makin tinggi**, jaga kuda-kuda", { delay: 35 });
  await sleep(900);
  await cap(p, "Tersimpan otomatis dan langsung masuk ke Grafik Keterampilan murid", null, 3400);
  await go(p, "lap", 1200);
  await cap(p, "Menu Laporan murid: progres sabuk, kehadiran, catatan pelatih, dan grafik keterampilan", "LAPORAN", 3800);
  await smoothScroll(p, 600, 1800);
  await cap(p, "Kirim laporan ke orang tua lewat WhatsApp atau salin link Portal. Selesai! 🎉", null, 3600);
  return rc;
};


// 11) Latihan TC (program latihan tambahan, khusus SaaS). Dijalankan SEBELUM video 10 supaya data contoh masih bersih.
if (SAAS) S["11-latihan-tc"] = async () => {
  const rc = await newRec(browser, { ...D, init: adminInit });
  const p = rc.page;
  await p.goto(base + "/"); await p.waitForSelector(NAV("tc")); await sleep(900);
  await go(p, "tc", 900);
  await cap(p, "Menu Latihan TC: sesi latihan tambahan untuk murid pilihan, mis. persiapan kejuaraan. Pesertanya boleh dari unit mana saja", "LATIHAN TC", 4600);
  await tap(p, "button[data-a=tcNew]", { after: 700 });
  await typeIn(p, "#tcNama", "TC Kejurda 2026", { delay: 60 });
  await p.fill("#tcMulai", "2026-11-01"); await p.fill("#tcSampai", "2026-12-20");
  await typeIn(p, "#tcHari", "Senin & Jumat", { delay: 45 });
  await typeIn(p, "#tcJam", "19.00–21.00", { delay: 45 });
  await typeIn(p, "#tcLok", "GOR Kota", { delay: 45 });
  await cap(p, "Isi nama program, periode, hari, jam, dan lokasi", null, 3000);
  // peserta dari dua unit berbeda (Utama + Cabang Timur)
  for (const id of ["alya-putri", "raka-pratama", "kevin-santoso"]) await tap(p, `input[data-tcp=${id}]`, { after: 450 });
  await cap(p, "Centang pesertanya. Murid dari unit berbeda boleh digabung. Gunakan kotak cari atau filter unit bila muridnya banyak", null, 4400);
  await tap(p, "button[data-a=tcSave]", { after: 1400 });
  await cap(p, "Program tersimpan, lengkap dengan jumlah peserta dan sesi", null, 3000);
  // program yang sedang berjalan langsung terbuka; bila belum, buka lewat tombol Absensi
  if (!(await p.locator("input[data-tca]").count())) await tap(p, "button[data-a=tcOpen]", { after: 900 });
  await p.evaluate(() => document.getElementById("tcDet")?.scrollIntoView({ block: "start" })); await sleep(700);
  await cap(p, "Tekan “Absensi”, pilih tanggal sesi, lalu ketuk murid yang hadir. Absensi TC terpisah, jadi persentase latihan rutin tidak berubah", "ABSENSI TC", 4800);
  for (const i of [0, 1]) await tap(p, "input[data-tca]", { nth: i, after: 500 });
  await cap(p, "Orang tua melihat jadwal dan jumlah kehadiran TC anaknya di Portal Orang Tua 🎉", null, 4200);
  return rc;
};

// 10) Unit sekolah, kelas murid, dan naik kelas (khusus SaaS)
if (SAAS) S["10-unit-sekolah-dan-naik-kelas"] = async () => {
  // data awal: unit "Cabang Timur" dijadikan unit sekolah dan beberapa murid diberi kelas (lewat API, di luar rekaman)
  const hdr = seed.H;
  await fetch(base + "/api/docs/units/cabang-timur", { method: "PUT", headers: hdr, body: JSON.stringify({ name: "Cabang Timur", fee: 100000, sekolah: true, klsMax: 6 }) });
  for (const [id, kls] of [["kevin-santoso", "6A"], ["dinda-lestari", "4B"], ["bagas-wibowo", "5A"]]) {
    const cur = await (await fetch(base + "/api/all", { headers: hdr })).json();
    const st = (cur.data.students || []).find(x => x.id === id);
    if (st) { const { id: _i, ...rest } = st; await fetch(base + "/api/docs/students/" + id, { method: "PUT", headers: hdr, body: JSON.stringify({ ...rest, kls }) }); }
  }
  const rc = await newRec(browser, { ...D, init: adminInit });
  const p = rc.page;
  await p.goto(base + "/"); await p.waitForSelector(NAV("jad")); await sleep(900);
  await go(p, "jad", 900);
  await cap(p, "Menu Jadwal & Unit: untuk dojang yang melatih di sekolah (ekskul), centang “Unit sekolah” pada unitnya", "UNIT SEKOLAH", 3800);
  await cap(p, "Atur kelas tertinggi di sekolah itu (bawaan 6 untuk SD). Murid di kelas tertinggi akan menjadi “Lulus”", null, 3800);
  await go(p, "mur", 900);
  await cap(p, "Di daftar Murid, kelas tampil sebagai label 🏫. Pilih unit sekolah di kiri atas untuk melihatnya", "KELAS MURID", 3400);
  await tap(p, "button[data-a=add]", { after: 700 });
  await typeIn(p, "#fn", "Salsa Nabila", { delay: 60 });
  await typeIn(p, "#fu", "Cabang Timur", { delay: 50 });
  await typeIn(p, "#fkls", "3A", { delay: 90 });
  await cap(p, "Form murid punya isian “Kelas di sekolah” (mis. 5A, IV-B, XI IPA 1). Kosongkan bila bukan unit sekolah", null, 4200);
  await tap(p, "button[data-a=save]", { after: 1400 });
  await go(p, "jad", 900);
  await cap(p, "Kenaikan kelas: tekan “Naik kelas” di unit sekolah. Semua murid unit itu naik satu kelas (4B → 5B, 6A → Lulus)", "NAIK KELAS", 4400);
  await tap(p, "button[data-a=naikKls]", { after: 700 });
  await cap(p, "Ada konfirmasi “Yakin?” supaya tidak tertekan tidak sengaja. Tekan sekali lagi untuk memproses", null, 3600);
  await tap(p, "button[data-a=naikKls]", { after: 1500 });
  await cap(p, "Selesai. Salah tekan? Tombol “Batalkan naik kelas” mengembalikan semuanya. Kelas juga bisa dipakai menyaring Murid, Absensi, dan Penilaian 🎉", null, 4800);
  return rc;
};

if (SAAS) {
// 7) Super Admin: klien baru + pembayaran manual
S["07-super-admin-klien-dan-pembayaran"] = async () => {
  const rc = await newRec(browser, { ...D });
  const p = rc.page;
  await p.goto(base + "/"); await p.waitForSelector("#usrInp"); await sleep(700);
  await cap(p, "Pemilik platform masuk dengan akun Super Admin", "SUPER ADMIN", 2400);
  await typeIn(p, "#usrInp", "superadmin", { delay: 60 });
  await typeIn(p, "#pinInp", "demo-super-2026", { delay: 60 });
  await tap(p, "#pinBtn", { after: 2000 });
  await p.waitForSelector("button[data-a=newClub]");
  await cap(p, "Panel Super Admin: semua dojang klien, masa aktif, dan jumlah murid mereka", null, 3200);
  await tap(p, "button[data-a=newClub]", { after: 800 });
  await cap(p, "Tambah dojang klien baru: nama, kode, username & PIN admin, pelatih utama", null, 3000);
  await typeIn(p, "#sc_name", "Naga Emas Taekwondo", { delay: 50 });
  await typeIn(p, "#sc_id", "nagaemas", { delay: 50 });
  await typeIn(p, "#sc_user", "nagaemas", { delay: 50 });
  await typeIn(p, "#sc_pin", "naga2026", { delay: 50 });
  await typeIn(p, "#sc_hc", "Sabeum Naga", { delay: 50 });
  await p.fill("#sc_exp", "2027-11-22"); await sleep(600);
  await cap(p, "Atur paket dan tanggal masa aktif langganan", null, 2600);
  await tap(p, "button[data-a=saveClub]", { after: 1800 });
  await cap(p, "Klien tersimpan. Tombol +1 Bln / +1 Thn memperpanjang cepat, 📲 Tagih WA mengirim tautan bayar", null, 4200);
  await go(p, "pay", 1200);
  await cap(p, "Menu Pembayaran: atur paket, harga, dan rekening / QRIS tujuan transfer", "PEMBAYARAN", 3400);
  await tap(p, "button[data-bill=addplan]", { after: 500 });
  // paket baru ada di baris terakhir (paket bawaan Basic & Pro sudah ada di atasnya)
  const nNew = Math.max(0, (await p.locator("[data-plrow]").count()) - 1);
  await typeIn(p, "[data-plrow] [data-f=name]", "Starter", { nth: nNew, delay: 60 }).catch(() => {});
  await typeIn(p, "[data-plrow] [data-f=price]", "100000", { nth: nNew, delay: 60 }).catch(() => {});
  await typeIn(p, "#bl_d12", "10", { delay: 80 });
  await typeIn(p, "#bl_bank", "BCA", { delay: 70 });
  await typeIn(p, "#bl_no", "1234567890", { delay: 50 });
  await typeIn(p, "#bl_an", "PT Dojang Digital", { delay: 50 });
  await cap(p, "Isi paket, diskon durasi, dan rekening. Klien belum bisa membayar sebelum ini diisi", null, 3600);
  await tap(p, "button[data-bill=save]", { after: 1500 });
  await makeClaimedInvoice(base, "garuda", "starter", 3);
  await go(p, "sa", 600); await go(p, "pay", 1400);
  await p.locator("text=Tagihan").first().scrollIntoViewIfNeeded().catch(() => {});
  await smoothScroll(p, 700, 1500);
  await cap(p, "Tagihan dari klien muncul di sini. Cocokkan nominal (termasuk 3 angka unik) dengan mutasi rekening", null, 4200);
  await tap(p, "button[data-bill=confirm]", { after: 700 });
  await cap(p, "Tekan Konfirmasi dua kali untuk memastikan. Masa aktif klien langsung bertambah", null, 3600);
  await tap(p, "button[data-bill=confirm]", { after: 1800 });
  await cap(p, "Pembayaran tunai atau di luar sistem bisa dicatat di bagian paling bawah. Selesai! 🎉", null, 3400);
  return rc;
};

// 8) Admin klub: perpanjang langganan
S["08-langganan-bayar"] = async () => {
  await ensureBilling(base);
  const rc = await newRec(browser, { ...D, init: adminInit });
  const p = rc.page;
  await p.goto(base + "/"); await p.waitForSelector(NAV("lgn")); await sleep(900);
  await go(p, "lgn", 1400);
  await cap(p, "Menu Langganan: lihat masa aktif dan perpanjang kapan saja", "LANGGANAN", 3200);
  await tap(p, "input[name=pay_plan][value=pro]", { after: 700 });
  await cap(p, "1. Pilih paket", null, 1800);
  await tap(p, "button[data-m=\"12\"]", { after: 700 });
  await cap(p, "2. Pilih durasi. Makin lama makin hemat", null, 2400);
  await typeIn(p, "#pay_name", "Sabeum Andi", { delay: 70 });
  await cap(p, "3. Tekan “Buat tagihan transfer”", null, 1800);
  await tap(p, "button[data-a=pay]", { after: 1600 });
  await cap(p, "Transfer tepat sesuai nominal (termasuk 3 angka unik) ke rekening atau scan QRIS", null, 4200);
  await tap(p, "#pay_note", { after: 200 }); await typeIn(p, "#pay_note", "a/n Sabeum Andi", { delay: 70 });
  await tap(p, "button[data-a=claim]", { after: 1500 });
  await cap(p, "Tekan “Saya sudah transfer”. Pengelola mengecek, lalu masa aktif otomatis bertambah", null, 4200);
  return rc;
};
}

const names = Object.keys(S).filter(n => !only.length || only.some(o => n.includes(o)));
import fs from "node:fs"; fs.mkdirSync(outDir, { recursive: true });
for (const n of names) {
  console.log("▶", n);
  try { const rc = await S[n](); await finish(rc, `${outDir}/${n}.webm`); }
  catch (e) { console.log("  GAGAL", n, e.message.split("\n")[0]); try { await globalThis.__lastPage.screenshot({ path: (process.env.REC_DBG || "/tmp") + "/_fail_" + n + ".png" }); } catch (x) {} }
}
await browser.close();
