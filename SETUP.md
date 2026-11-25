# Setup Dojang HQ (multi-klub / SaaS)

Satu aplikasi untuk banyak dojang. Data tiap klub terpisah, dan setiap klub punya admin, pelatih, logo, dan pengaturan sendiri.

## 1. Buat database D1
1. Cloudflare dashboard → Storage & Databases → D1 SQL database → Create → nama `dojang-db`.
2. Buka database itu → tab Console → paste isi `schema.sql` → Execute.

## 2. Deploy ke Pages
Hubungkan repo ini ke Cloudflare Pages (Workers & Pages → Create → Pages → Connect to Git). Tanpa build command, output directory `/`. Folder `functions/` otomatis menjadi API.

## 3. Hubungkan D1
Project → Settings → Bindings → Add → D1 database
- Variable name: `DB`
- Database: `dojang-db`

## 4. Isi Environment variables (Settings → Variables and Secrets)
Wajib:
- `SUPERADMIN_PIN` — kata sandi Super Admin (pemilik platform). Pakai minimal 12 karakter, acak. Tanpa ini Super Admin tidak bisa masuk (tidak ada PIN bawaan).
- `TOKEN_SECRET` — teks acak panjang (32+ karakter) untuk menandatangani login admin dan pelatih. Beda dengan `SUPERADMIN_PIN`. Tanpa ini admin tidak bisa masuk.

Opsional (fitur Analisa Video AI):
- Binding Workers AI dengan nama `AI`, atau
- `GEMINI_API_KEY`, atau `ANTHROPIC_API_KEY`
- `ANALYZE_DAILY_LIMIT` — batas analisa per klub per hari (bawaan 30)

Setelah mengubah variabel, deploy ulang.

## 5. Alur penggunaan
1. Super Admin masuk (user `superadmin` + `SUPERADMIN_PIN`) → Kelola Dojang Klien → buat klub baru (nama, kode klub, user admin, PIN admin, pelatih utama, masa aktif).
2. Admin klub masuk dengan kode klub + user + PIN, lalu mengisi murid, unit, jadwal, dan logo.
3. Pelatih mendaftar sendiri lewat tautan `?daftar=1&club=KODE`. Akun berstatus menunggu sampai pelatih utama menyetujuinya di menu Pelatih. Pelatih utama juga bisa membuat akun langsung atau banyak sekaligus.
4. Pelatih masuk lewat `?pelatih=1&club=KODE`. Pelatih hanya melihat murid di unit yang diberikan dan tidak melihat nomor WA atau iuran.
5. Orang tua membuka tautan portal murid yang dibagikan admin.

## Fitur untuk admin & orang tua
- **Pengumuman** (menu Pengumuman, hanya Admin klub): tampil di Dashboard dan Portal Orang Tua sesuai unit dan tanggal tayang. Pelatih ikut melihatnya di dashboard, hanya untuk unit yang diberikan kepadanya.
- **Ringkasan bulanan** (hanya Admin klub, karena memuat iuran): murid baru, iuran, kehadiran per unit, naik sabuk, penilaian. Bisa disalin untuk WA atau diunduh CSV.
- **Tanggal lahir** murid (opsional): usia dihitung otomatis. **Riwayat sabuk** dicatat saat lulus ujian atau sabuk dinaikkan.
- **Absensi & iuran aman**: hanya centang yang berubah yang dikirim, jadi centang pelatih tidak tertimpa. Tanpa sinyal, perubahan disimpan di HP (admin maupun pelatih) dan dikirim otomatis saat online.
- **Portal Orang Tua** meminta nama anak sekali per HP (nama salah satu saudara kandung cukup). Nomor WA pelatih baru tampil setelah itu.
- Admin terkunci otomatis bila 12 jam tidak dipakai. Setiap simpan/hapus oleh admin tercatat di Riwayat aktivitas.

## Keamanan
- Login admin dibatasi 10 percobaan gagal per 15 menit per IP.
- Sandi pelatih dan PIN admin klub disimpan ter-hash (PBKDF2). PIN lama yang masih berupa teks otomatis di-hash saat admin klub berhasil masuk berikutnya.
- Setelah masuk, aplikasi memakai token bertanda tangan (admin klub 7 hari, Super Admin 12 jam). PIN tidak disimpan di HP dan tidak dikirim di tiap permintaan. Mengganti PIN (atau `SUPERADMIN_PIN`) otomatis mengeluarkan sesi lama.
- PIN tidak pernah dikirim balik ke aplikasi. Saat Super Admin mengubah data klub, kolom PIN yang dikosongkan berarti PIN tidak diganti.
- Ulasan orang tua untuk pelatih ditampilkan secara publik tanpa nama orang tua dan murid.
- Header keamanan di `_headers`: Content-Security-Policy (hanya sumber yang dikenal: situs sendiri, Google Fonts, dan model pose MediaPipe), HSTS, anti-iframe, `nosniff`, kebijakan kamera hanya untuk situs sendiri.
- Koleksi internal (`staff`, `clubs`, `invoices`, `billing_settings`, `ai_usage`, Champion) tidak bisa diubah lewat API data umum. Kuota harian Analisa Video tidak bisa direset oleh admin klub.
- Unggahan data lewat API dibatasi 2 MB. Data dari pengguna selalu di-escape sebelum tampil.
- Untuk pengamanan Super Admin yang lebih kuat, pasang Cloudflare Access (Zero Trust → Access → Applications → Self-hosted, domain aplikasi, policy Allow untuk email Anda, login One-time PIN). Gratis sampai 50 pengguna.

## Catatan
- Data tersimpan di D1, sinkron antar HP, dan diperbarui otomatis (lebih jarang saat aplikasi tidak dipakai, berhenti saat tab tertutup).
- Bila data tidak berubah, server hanya membalas "tidak ada perubahan" (HTTP 304), jadi sinkron berkala hampir tidak memakai kuota data HP.
- Index database `docs_club_coll` dibuat otomatis saat API pertama kali dipakai (juga ada di `schema.sql`). Index ini membuat pencarian data per klub tidak lagi membaca seluruh tabel semua klub, sehingga hemat kuota baca D1 dan tetap cepat walau klien bertambah.
- Klub yang masa aktifnya habis atau ditangguhkan tidak bisa dipakai (portal menampilkan pesan).

## 🏆 Champion (PR latihan di rumah)
Aplikasi PWA terpisah di alamat `/champion` (domain yang sama dengan Dojang HQ), untuk latihan PR di rumah dengan cek gerakan lewat kamera HP (AI berjalan di HP, video tidak dikirim).
- **Anak / orang tua**: buka Portal Orang Tua → tombol **🏆 Champion**. Nama anak otomatis dari verifikasi portal (saudara kandung bisa dipilih). Bisa dipasang sebagai aplikasi sendiri (ikon Champion).
- **Murid langsung (tanpa Portal Orang Tua)**: di daftar Murid tekan **🏆 Champion** untuk menyalin link `/champion?id=...`, kirim ke murid. Murid cukup mengetik namanya sendiri (nama saudara kandung tidak diterima, dan akses hanya untuk dirinya).
- **Admin & pelatih**: menu **🏆 Champion (PR)** → atur PR aktif klub (21 latihan kekuatan & kelenturan, target, pesan; bisa **sama untuk semua** atau **🎲 acak per anak** dengan jumlah latihan per anak, opsional acak ulang tiap hari), lihat siapa yang sudah / belum latihan per tanggal & unit, skor, foto posisi terbaik, kirim rekap atau pengumuman ke WA. Pelatih hanya melihat murid di unitnya; mengatur PR butuh izin absen atau penilaian.
- Data: koleksi `champion` (hasil), `champion_foto` (foto, otomatis dihapus setelah 60 hari), `champion_pr` (PR aktif). Tidak ikut sinkron data admin, jadi aplikasi tetap ringan. Tidak perlu pengaturan tambahan.

## 💳 Paket, harga & pembayaran langganan
### Skema paket bawaan
Harga dipatok jauh di bawah aplikasi sejenis (sekitar Rp199 ribu per bulan). Semua angka bisa diubah di Super Admin → 💰 Pembayaran.

| Paket | Harga / bulan | Murid aktif | Unit | Analisa Video AI Cloud |
|---|---|---|---|---|
| **Basic** | Rp 59.000 | maks 60 | 1 | tidak (mode analisa di perangkat tetap gratis) |
| **Pro** | Rp 129.000 | tanpa batas | tanpa batas | ya (maks 30 analisa/hari/klub) |

Diskon durasi: 3 bulan 5%, 6 bulan 10%, 12 bulan 20% (Basic setahun ≈ Rp47 ribu/bulan, Pro setahun ≈ Rp108 ribu/bulan). Harga dibulatkan ke Rp1.000.

Batas dijalankan oleh server, bukan sekadar label: murid baru / unit baru ditolak bila paket penuh (pesan meminta upgrade), murid cuti tidak dihitung, data lama tidak pernah dihapus bila paket diturunkan, dan klub dengan nama paket yang tidak dikenal tidak diblokir. Upgrade dilakukan dengan membayar paket yang lebih tinggi (masa aktif disambung dari tanggal berakhir, tanpa pro-rata). Menu **💳 Langganan** menampilkan pemakaian (mis. 45/60 murid).

### Alur klien
Klien membayar lewat satu halaman: `https://DOMAIN/?bayar=1&club=KODE` (tanpa login, jadi klub yang sudah kedaluwarsa tetap bisa bayar). Tautan juga ada di pesan **📲 Tagih WA**, di layar masuk saat langganan habis, dan di menu **💳 Langganan**. Masa aktif otomatis disambung dan klub yang ditangguhkan karena belum bayar otomatis aktif lagi.

### Verifikasi manual (tanpa payment gateway)
Payment gateway sengaja belum dipasang. Alurnya:
1. **Atur sekali saja**: Super Admin → 💰 Pembayaran → cek paket & harga, isi rekening bank dan/atau unggah gambar QRIS, dan nomor WhatsApp penerima bukti. Klien belum bisa membayar sebelum rekening/QRIS diisi.
2. **Klien**: pilih paket → durasi → *Buat tagihan transfer*. Klien mendapat nominal + 3 angka unik (mis. Rp 450.123) supaya mudah dicocokkan di mutasi rekening, lalu menekan **Saya sudah transfer** (atau mengirim bukti via WhatsApp).
3. **Super Admin**: tagihan yang dikonfirmasi klien ditandai merah. Cocokkan dengan mutasi, lalu tekan **✅ Konfirmasi**. Masa aktif otomatis disambung dan klub yang ditangguhkan otomatis aktif lagi. **Tolak** membatalkan tagihan.
4. Pembayaran tunai dicatat lewat **Catat pembayaran di luar sistem**.

Data: koleksi `invoices` (tagihan) dan `billing_settings` (pengaturan) tidak ikut sinkron data klub dan tidak bisa diubah lewat API umum. Konfirmasi dua kali tidak memperpanjang dua kali.

## 📖 Panduan video
Video cara memakai fitur ada di folder `panduan/` dan bisa dibuka tanpa login di `/?panduan=1` (juga lewat menu **📖 Panduan** untuk admin klub dan Super Admin, tautan di layar masuk, dan tombol di Portal Orang Tua serta Champion). Video direkam otomatis dari aplikasi asli dengan data contoh memakai skrip di folder `tools-panduan/` (lihat `tools-panduan/README.md`); rekam ulang bila tampilan aplikasi berubah.

## 🧠 Log teknis & penyetelan otomatis (Analisa Video)
- Tiap analisa video mengirim log anonim ke `/api/techlog`: angka titik tubuh (13 titik, tanpa gambar, nama, atau ID murid), penyebab frame ditolak, dan hasil analisa. Error aplikasi (maks. 5 per sesi) juga dicatat. Kamera live hanya mengirim ringkasan.
- Menu Super Admin **🧠 Log Teknis & Penyetelan**: satu klik **Pelajari log & setel otomatis** menguji ulang rekaman di log dengan berbagai ambang penyaring, memilih ambang terbaik dalam batas aman, menerapkannya ke semua klien, lalu menghapus log yang sudah dipakai. **Kembalikan setelan sebelumnya** membatalkannya.
- Batas aman (`BOUNDS` di `functions/api/techlog.js` = `PG_BOUNDS` di `index.html`) menjaga supaya kerangka di benda tetap tertolak. Laporan "kerangka di benda" dari pelatih membuat ambang dikencangkan kembali, bukan dilonggarkan.
- Error kode tidak bisa diperbaiki otomatis: pakai **Salin ringkasan untuk Claude**, lalu tempel ke sesi Claude.
- Log disimpan maks. 60 hari (dan maks. 400 log terbaru). Koleksi `techlog` dan `pose_cfg` tidak ikut sinkron data klub dan tidak bisa diubah lewat API umum.
