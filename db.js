import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const PRIVATE_DIR = path.join(DATA_DIR, 'private');
export const PUBLIC_DIR = path.join(DATA_DIR, 'public');

for (const dir of [DATA_DIR, PRIVATE_DIR, PUBLIC_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'beatstore.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS shops (
  shop          TEXT PRIMARY KEY,
  access_token  TEXT NOT NULL,
  installed_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  shop                TEXT NOT NULL,
  kind                TEXT NOT NULL,          -- 'beat' or 'pack'
  title               TEXT NOT NULL,
  bpm                 INTEGER,
  music_key           TEXT,
  genre               TEXT,
  tags                TEXT,
  description         TEXT,
  artwork             TEXT,                   -- filename in public dir
  preview             TEXT,                   -- filename in public dir
  shopify_product_id  TEXT,
  shopify_handle      TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL,
  tier        TEXT NOT NULL,
  price       TEXT NOT NULL,
  file_path   TEXT NOT NULL,                  -- absolute path, never served directly
  file_name   TEXT NOT NULL,
  variant_id  TEXT,                           -- numeric Shopify variant id
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS licenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop          TEXT NOT NULL,
  order_id      TEXT NOT NULL,
  order_number  TEXT,
  product_id    INTEGER NOT NULL,
  asset_id      INTEGER NOT NULL,
  tier          TEXT NOT NULL,
  buyer_name    TEXT,
  buyer_email   TEXT,
  license_code  TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE,
  pdf_path      TEXT,
  downloads     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_variant ON assets(variant_id);
CREATE INDEX IF NOT EXISTS idx_licenses_order ON licenses(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_unique ON licenses(order_id, asset_id);
`);

export default db;
