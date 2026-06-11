'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const COOKIE = 'sid';

const qSession = db.prepare(`
  SELECT u.id, u.username, u.is_admin, s.token
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token = ?
`);
const qInsertSession = db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)');
const qDeleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');
const qDeleteOtherSessions = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?');
const qDeleteUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');
const qUserByName = db.prepare('SELECT * FROM users WHERE username = ?');

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function attachUser(req, res, next) {
  const token = getCookie(req, COOKIE);
  if (token) {
    const row = qSession.get(token);
    if (row) req.user = { id: row.id, username: row.username, isAdmin: !!row.is_admin, token };
  }
  res.locals.user = req.user || null;
  next();
}

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  qInsertSession.run(token, userId);
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=31536000'];
  if (req.secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${attrs.join('; ')}`);
}

function destroySession(req, res) {
  if (req.user) qDeleteSession.run(req.user.token);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function verifyLogin(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  const u = qUserByName.get(username.trim());
  if (!u) return null;
  return bcrypt.compareSync(password, u.password_hash) ? u : null;
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requireLoginApi(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'nicht angemeldet' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (!req.user.isAdmin) return res.status(403).send('Kein Zugriff');
  next();
}

// Einfache Brute-Force-Bremse: max. 15 Fehlversuche pro IP in 15 Minuten
const fails = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 15;

function loginAllowed(ip) {
  const e = fails.get(ip);
  if (!e) return true;
  if (Date.now() - e.first > WINDOW_MS) { fails.delete(ip); return true; }
  return e.count < MAX_FAILS;
}

function recordFail(ip) {
  const e = fails.get(ip);
  if (!e || Date.now() - e.first > WINDOW_MS) fails.set(ip, { first: Date.now(), count: 1 });
  else e.count++;
}

module.exports = {
  attachUser, createSession, destroySession, verifyLogin,
  requireLogin, requireLoginApi, requireAdmin,
  loginAllowed, recordFail,
  deleteOtherSessions: (userId, keepToken) => qDeleteOtherSessions.run(userId, keepToken),
  deleteUserSessions: (userId) => qDeleteUserSessions.run(userId),
};
