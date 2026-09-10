const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/txTrace.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db;

function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      // Use Node built-in SQLite (Fast, stable, zero native compilation headaches)
      const { DatabaseSync } = require('node:sqlite');
      const rawDb = new DatabaseSync(DB_PATH);
      rawDb.exec('PRAGMA journal_mode = WAL');
      rawDb.exec('PRAGMA foreign_keys = ON');

      db = {
        exec: (sql) => rawDb.exec(sql),
        pragma: (p) => rawDb.exec(`PRAGMA ${p}`),
        prepare: (sql) => {
          const stmt = rawDb.prepare(sql);
          return {
            run: (...params) => {
              const res = stmt.run(...params);
              return {
                lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null,
                changes: res.changes
              };
            },
            get: (...params) => stmt.get(...params),
            all: (...params) => stmt.all(...params)
          };
        },
        transaction: (fn) => {
          return (...args) => {
            rawDb.exec('BEGIN TRANSACTION');
            try {
              const result = fn(...args);
              rawDb.exec('COMMIT');
              return result;
            } catch (err) {
              rawDb.exec('ROLLBACK');
              throw err;
            }
          };
        }
      };
    } catch (err) {
      // Fallback to better-sqlite3 if node:sqlite is unavailable
      const Database = require('better-sqlite3');
      db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
    }

    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);

    // ── Migrations: safely add columns that may not exist in older databases ──
    const migrations = [
      // v1: invoice days (original)
      "ALTER TABLE payment_institutions ADD COLUMN invoice_closing_day INTEGER DEFAULT 5",
      "ALTER TABLE payment_institutions ADD COLUMN invoice_due_day INTEGER DEFAULT 10",

      // v2: card linked to parent institution (bank → card hierarchy)
      "ALTER TABLE payment_institutions ADD COLUMN parent_institution_id INTEGER DEFAULT NULL REFERENCES payment_institutions(id) ON DELETE SET NULL",

      // v3: soft-delete for default categories (user can hide but not permanently delete shared rows)
      "ALTER TABLE categories ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE categories ADD COLUMN hidden_by_user_id INTEGER DEFAULT NULL",

      // v4: loan direction (given = you lent, received = you borrowed)
      "ALTER TABLE loans ADD COLUMN loan_direction TEXT NOT NULL DEFAULT 'given'",
      "ALTER TABLE loans ADD COLUMN creditor_name TEXT DEFAULT NULL",
      "ALTER TABLE loans ADD COLUMN interest_rate REAL DEFAULT NULL",
      "ALTER TABLE loans ADD COLUMN interest_rate_type TEXT DEFAULT NULL",
      "ALTER TABLE loans ADD COLUMN total_with_interest REAL DEFAULT NULL",
    ];
    migrations.forEach(sql => {
      try { db.exec(sql); } catch (_) { /* column/constraint already exists, ignore */ }
    });

    // v4b: new tables for parallel interest return stream and per-user hidden default categories
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_hidden_categories (
        user_id     INTEGER NOT NULL,
        category_id INTEGER NOT NULL,
        created_at  TEXT DEFAULT (datetime('now', 'localtime')),
        PRIMARY KEY (user_id, category_id)
      );

      CREATE TABLE IF NOT EXISTS loan_interest_returns (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        loan_id               INTEGER NOT NULL UNIQUE,
        total_amount          REAL NOT NULL,
        total_installments    INTEGER NOT NULL DEFAULT 1,
        first_installment_date TEXT NOT NULL,
        notes                 TEXT DEFAULT NULL,
        created_at            TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS loan_interest_return_installments (
        id                        INTEGER PRIMARY KEY AUTOINCREMENT,
        loan_interest_return_id   INTEGER NOT NULL,
        installment_number        INTEGER NOT NULL,
        due_date                  TEXT NOT NULL,
        amount                    REAL NOT NULL,
        is_received               INTEGER NOT NULL DEFAULT 0,
        received_date             TEXT DEFAULT NULL,
        FOREIGN KEY (loan_interest_return_id) REFERENCES loan_interest_returns(id) ON DELETE CASCADE
      );
    `);

  }
  return db;
}

module.exports = { getDb };
