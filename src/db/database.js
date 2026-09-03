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
  }
  return db;
}

module.exports = { getDb };
