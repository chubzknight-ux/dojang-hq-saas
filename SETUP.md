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
- `TOKEN_SECRET` — teks acak panjang (32+ karakter) untuk menandatangani login pelatih. Beda dengan `SUPERADMIN_PIN`.

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

## Keamanan
- Login admin dibatasi 10 percobaan gagal per 15 menit per IP.
- Sandi pelatih disimpan ter-hash (PBKDF2). PIN admin klub masih disimpan apa adanya; gunakan PIN unik per klub.
- Untuk pengamanan Super Admin yang lebih kuat, pasang Cloudflare Access (Zero Trust → Access → Applications → Self-hosted, domain aplikasi, policy Allow untuk email Anda, login One-time PIN). Gratis sampai 50 pengguna.

## Catatan
- Data tersimpan di D1, sinkron antar HP, dan diperbarui otomatis tiap beberapa detik.
- Klub yang masa aktifnya habis atau ditangguhkan tidak bisa dipakai (portal menampilkan pesan).
