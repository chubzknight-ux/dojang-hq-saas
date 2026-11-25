CREATE TABLE IF NOT EXISTS docs (
  coll TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (coll, id)
);
-- Mempercepat pencarian data per klub (dibuat otomatis oleh aplikasi juga, aman dijalankan berulang)
CREATE INDEX IF NOT EXISTS docs_club_coll ON docs(json_extract(data,'$.clubId'), coll);

-- Riwayat aktivitas admin (tabel terpisah supaya tidak ikut terunduh di /api/all).
-- Aplikasi tetap membuatnya otomatis bila belum ada, tapi lebih rapi dibuat di sini sekali saja.
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club TEXT,
  t TEXT NOT NULL,
  who TEXT,
  role TEXT,
  action TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_club ON audit_log(club, id);
