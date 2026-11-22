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

Pembayaran langganan online (opsional, lihat bagian "Pembayaran langganan" di bawah):
- `XENDIT_SECRET_KEY` — API key Xendit (tipe Secret, izin Invoice: write).
- `XENDIT_CALLBACK_TOKEN` — "Verification Token" webhook dari Xendit.

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

## 💳 Pembayaran langganan
Klien membayar sendiri lewat satu halaman: `https://DOMAIN/?bayar=1&club=KODE`. Tautan ini tidak memerlukan login, jadi klub yang masa aktifnya sudah habis pun tetap bisa membayar. Tautan juga otomatis ada di pesan **📲 Tagih WA** (Super Admin), di tombol **Bayar / perpanjang sekarang** pada layar masuk saat langganan habis, dan di menu **💳 Langganan** (admin klub).

Alur klien: pilih paket → pilih durasi (1/3/6/12 bulan, ada diskon durasi) → pilih cara bayar → selesai. Masa aktif otomatis disambung dari tanggal berakhir (atau dari hari ini bila sudah habis) dan klub yang ditangguhkan karena belum bayar otomatis aktif lagi.

### A. Atur paket & harga (wajib, sekali saja)
Super Admin → menu **💰 Pembayaran** → isi paket (nama, harga per bulan), diskon durasi, lalu Simpan. Klien belum bisa membayar sebelum minimal satu paket diisi.

### B. Pembayaran online otomatis (Xendit, disarankan)
Satu halaman bayar berisi QRIS, Virtual Account (BCA, Mandiri, BNI, BRI, dll.), e-wallet (GoPay, OVO, DANA, ShopeePay), dan minimarket.
1. Daftar di xendit.co, lalu **Settings → API Keys → Generate secret key** dengan izin *Invoices: Write*. Isi di Cloudflare sebagai Secret `XENDIT_SECRET_KEY`.
2. **Settings → Webhooks → Invoices paid** (dan *Invoices expired*): isi URL `https://DOMAIN/api/pay-hook`. Salin *Verification Token* ke Secret `XENDIT_CALLBACK_TOKEN`.
3. Deploy ulang. Menu **💰 Pembayaran** menampilkan status "Kunci API terpasang" dan "Webhook siap".

Keamanan: webhook memeriksa token, lalu status dan nominal tagihan diverifikasi ulang langsung ke Xendit sebelum masa aktif diperpanjang. Webhook ganda tidak memperpanjang dua kali. Selama kunci Xendit belum diisi, tombol bayar online otomatis tersembunyi.

### C. Transfer manual / QRIS statis (tanpa gateway)
Di menu **💰 Pembayaran** isi rekening dan/atau unggah gambar QRIS. Klien mendapat nominal + 3 angka unik (mis. Rp 450.123) supaya mudah dicocokkan di mutasi, menekan **Saya sudah transfer** atau mengirim bukti via WhatsApp, lalu Super Admin menekan **✅ Konfirmasi** dan masa aktif otomatis bertambah. Pembayaran tunai bisa dicatat lewat **Catat pembayaran di luar sistem**.

Data: koleksi `invoices` (tagihan) dan `billing_settings` (pengaturan), keduanya tidak ikut sinkron data klub dan tidak bisa diubah lewat API umum.
