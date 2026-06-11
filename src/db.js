'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tippspiel.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id          INTEGER PRIMARY KEY,
    round       INTEGER NOT NULL,
    group_name  TEXT,
    kickoff_utc TEXT NOT NULL,
    venue       TEXT,
    home_team   TEXT NOT NULL,
    away_team   TEXT NOT NULL,
    home_score  INTEGER,
    away_score  INTEGER
  );

  CREATE TABLE IF NOT EXISTS tips (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    home_goals INTEGER NOT NULL,
    away_goals INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, match_id)
  );

  CREATE INDEX IF NOT EXISTS idx_tips_match ON tips(match_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS bonus_tips (
    user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    champion      TEXT,
    germany_round INTEGER,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Schema-Migrationen für bestehende Datenbanken
function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('matches', 'status', "status TEXT NOT NULL DEFAULT 'scheduled'");
ensureColumn('matches', 'home_final', 'home_final INTEGER');
ensureColumn('matches', 'away_final', 'away_final INTEGER');
ensureColumn('matches', 'result_note', 'result_note TEXT');
db.prepare("UPDATE matches SET status = 'finished' WHERE home_score IS NOT NULL AND status = 'scheduled'").run();

const qGetSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const qSetSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const qDelSetting = db.prepare('DELETE FROM settings WHERE key = ?');

function getSetting(key) {
  const row = qGetSetting.get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  if (value == null || value === '') qDelSetting.run(key);
  else qSetSetting.run(key, String(value));
}

function feedDateToIso(s) {
  // Feed-Format: "2026-06-11 19:00:00Z"
  return new Date(s.replace(' ', 'T')).toISOString();
}

function seedMatches() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM matches').get().c;
  if (count > 0) return;
  const file = path.join(__dirname, '..', 'data', 'schedule.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ins = db.prepare(`
    INSERT INTO matches (id, round, group_name, kickoff_utc, venue, home_team, away_team, home_score, away_score)
    VALUES (@id, @round, @group_name, @kickoff_utc, @venue, @home_team, @away_team, @home_score, @away_score)
  `);
  db.transaction(() => {
    for (const m of raw) {
      ins.run({
        id: m.MatchNumber,
        round: m.RoundNumber,
        group_name: m.Group,
        kickoff_utc: feedDateToIso(m.DateUtc),
        venue: m.Location,
        home_team: m.HomeTeam,
        away_team: m.AwayTeam,
        home_score: m.HomeTeamScore,
        away_score: m.AwayTeamScore,
      });
    }
  })();
  console.log(`Spielplan importiert: ${raw.length} Spiele`);
}

function seedAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;
  const username = process.env.ADMIN_USER || 'admin';
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(9).toString('base64url');
    generated = true;
  }
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)')
    .run(username, bcrypt.hashSync(password, 10));
  if (generated) {
    console.log('='.repeat(52));
    console.log('  Admin-Account angelegt:');
    console.log(`  Benutzer: ${username}`);
    console.log(`  Passwort: ${password}`);
    console.log('  (per ADMIN_PASSWORD-Umgebungsvariable setzbar)');
    console.log('='.repeat(52));
  } else {
    console.log(`Admin-Account "${username}" angelegt (Passwort aus ADMIN_PASSWORD).`);
  }
}

seedMatches();
seedAdmin();

// Sitzungen älter als 90 Tage aufräumen
db.prepare("DELETE FROM sessions WHERE created_at < datetime('now', '-90 days')").run();

module.exports = { db, feedDateToIso, getSetting, setSetting };
