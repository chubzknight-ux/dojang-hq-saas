CREATE TABLE IF NOT EXISTS docs (
  coll TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (coll, id)
);
-- Mempercepat pencarian data per klub (dibuat otomatis oleh aplikasi juga, aman dijalankan berulang)
CREATE INDEX IF NOT EXISTS docs_club_coll ON docs(json_extract(data,'$.clubId'), coll);
