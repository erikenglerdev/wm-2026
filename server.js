'use strict';

const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');

const { db, getSetting, setSetting } = require('./src/db');
const auth = require('./src/auth');
const { points, BONUS_POINTS } = require('./src/score');
const { teamName, teamFlag, isPlaceholder, teamOptions, teamExists } = require('./src/teams');
const {
  fmtDay, fmtDayShort, fmtTime, isToday, isTomorrow,
  stageLabel, roundLabel, BONUS_ROUNDS, BONUS_ROUNDS_SHORT,
} = require('./src/format');
const { syncFromFeed, startAutoSync, FEED_URL } = require('./src/sync');

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(auth.attachUser);

// Cache-Busting für statische Assets (ändert sich bei jedem Serverstart)
app.locals.assetV = Date.now().toString(36);

// Helfer, die alle Views nutzen dürfen
app.locals.teamName = teamName;
app.locals.teamFlag = teamFlag;
app.locals.BONUS_ROUNDS = BONUS_ROUNDS;
app.locals.BONUS_ROUNDS_SHORT = BONUS_ROUNDS_SHORT;
app.locals.BONUS_POINTS = BONUS_POINTS;

const qMatches = db.prepare('SELECT * FROM matches ORDER BY kickoff_utc, id');
const qMatch = db.prepare('SELECT * FROM matches WHERE id = ?');
const qFirstKickoff = db.prepare('SELECT MIN(kickoff_utc) AS k FROM matches');
const qTipsByUser = db.prepare('SELECT * FROM tips WHERE user_id = ?');
const qTip = db.prepare('SELECT * FROM tips WHERE user_id = ? AND match_id = ?');
const qUpsertTip = db.prepare(`
  INSERT INTO tips (user_id, match_id, home_goals, away_goals, updated_at)
  VALUES (?, ?, ?, ?, datetime('now'))
  ON CONFLICT(user_id, match_id)
  DO UPDATE SET home_goals = excluded.home_goals, away_goals = excluded.away_goals, updated_at = excluded.updated_at
`);
const qDeleteTip = db.prepare('DELETE FROM tips WHERE user_id = ? AND match_id = ?');
const qTipsForMatch = db.prepare(`
  SELECT t.*, u.username FROM tips t JOIN users u ON u.id = t.user_id WHERE t.match_id = ?
`);
const qUsers = db.prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY username COLLATE NOCASE');
const qUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const qBonus = db.prepare('SELECT * FROM bonus_tips WHERE user_id = ?');
const qUpsertBonus = db.prepare(`
  INSERT INTO bonus_tips (user_id, champion, germany_round, updated_at)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(user_id)
  DO UPDATE SET champion = excluded.champion, germany_round = excluded.germany_round, updated_at = excluded.updated_at
`);
const qAllBonus = db.prepare(`
  SELECT b.*, u.username FROM bonus_tips b JOIN users u ON u.id = b.user_id ORDER BY u.username COLLATE NOCASE
`);

const isLocked = (m) => Date.now() >= Date.parse(m.kickoff_utc);
const bonusLocked = () => Date.now() >= Date.parse(qFirstKickoff.get().k);
const bonusResults = () => ({
  champion: getSetting('champion_result') || null,
  germanyRound: getSetting('germany_round_result') ? Number(getSetting('germany_round_result')) : null,
});

function matchView(m, tip) {
  const locked = isLocked(m);
  return {
    id: m.id,
    round: m.round,
    stage: stageLabel(m),
    day: fmtDay(m.kickoff_utc),
    dayShort: fmtDayShort(m.kickoff_utc),
    time: fmtTime(m.kickoff_utc),
    venue: m.venue,
    today: isToday(m.kickoff_utc),
    tomorrow: isTomorrow(m.kickoff_utc),
    locked,
    status: m.status || 'scheduled',
    live: m.status === 'live',
    hasResult: m.home_score != null && m.away_score != null,
    hs: m.home_score,
    as: m.away_score,
    final: m.home_final != null && m.away_final != null ? { h: m.home_final, a: m.away_final } : null,
    note: m.result_note || null,
    home: { name: teamName(m.home_team), flag: teamFlag(m.home_team), tbd: isPlaceholder(m.home_team) },
    away: { name: teamName(m.away_team), flag: teamFlag(m.away_team), tbd: isPlaceholder(m.away_team) },
    tip: tip || null,
    pts: tip ? points(tip.home_goals, tip.away_goals, m.home_score, m.away_score) : null,
  };
}

function leaderboard() {
  const users = qUsers.all();
  const matches = new Map(qMatches.all().map(m => [m.id, m]));
  const tips = db.prepare('SELECT * FROM tips').all();
  const rows = new Map(users.map(u => [u.id, {
    id: u.id, username: u.username, isAdmin: !!u.is_admin,
    total: 0, c4: 0, c3: 0, c2: 0, c0: 0, bonus: 0, tips: 0,
  }]));
  for (const t of tips) {
    const row = rows.get(t.user_id);
    const m = matches.get(t.match_id);
    if (!row || !m) continue;
    row.tips++;
    const p = points(t.home_goals, t.away_goals, m.home_score, m.away_score);
    if (p == null) continue;
    row.total += p;
    if (p === 4) row.c4++;
    else if (p === 3) row.c3++;
    else if (p === 2) row.c2++;
    else row.c0++;
  }
  const res = bonusResults();
  for (const b of qAllBonus.all()) {
    const row = rows.get(b.user_id);
    if (!row) continue;
    let bp = 0;
    if (res.champion && b.champion === res.champion) bp += BONUS_POINTS;
    if (res.germanyRound && b.germany_round === res.germanyRound) bp += BONUS_POINTS;
    row.bonus = bp;
    row.total += bp;
  }
  return [...rows.values()].sort((a, b) =>
    b.total - a.total || b.c4 - a.c4 || b.c3 - a.c3 || a.username.localeCompare(b.username, 'de'));
}

// ---------- Login / Logout ----------

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Anmelden', active: null, error: null });
});

app.post('/login', async (req, res) => {
  const ip = req.ip;
  if (!auth.loginAllowed(ip)) {
    return res.status(429).render('login', { title: 'Anmelden', active: null, error: 'Zu viele Fehlversuche. Bitte später erneut versuchen.' });
  }
  const u = auth.verifyLogin(req.body.username, req.body.password);
  if (!u) {
    auth.recordFail(ip);
    await new Promise(r => setTimeout(r, 400));
    return res.status(401).render('login', { title: 'Anmelden', active: null, error: 'Benutzername oder Passwort falsch.' });
  }
  auth.createSession(req, res, u.id);
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  auth.destroySession(req, res);
  res.redirect('/login');
});

// ---------- Tippen ----------

app.get('/', auth.requireLogin, (req, res) => {
  const tipMap = new Map(qTipsByUser.all(req.user.id).map(t => [t.match_id, t]));
  const groups = [];
  let current = null;
  for (const m of qMatches.all()) {
    const vm = matchView(m, tipMap.get(m.id));
    if (!current || current.label !== vm.day) {
      current = { label: vm.day, matches: [] };
      groups.push(current);
    }
    current.matches.push(vm);
  }
  const board = leaderboard();
  const rank = board.findIndex(r => r.id === req.user.id) + 1;
  const me = board[rank - 1] || null;

  const firstK = qFirstKickoff.get().k;
  res.render('index', {
    title: 'Tippen', active: 'tippen', groups, me, rank,
    totalMatches: qMatches.all().length,
    bonus: qBonus.get(req.user.id) || null,
    bonusLocked: bonusLocked(),
    bonusResults: bonusResults(),
    teamOptions: teamOptions(),
    roundOptions: Object.entries(BONUS_ROUNDS).map(([v, l]) => ({ value: Number(v), label: l })),
    firstKickoffStr: `${fmtDayShort(firstK)}, ${fmtTime(firstK)} Uhr`,
  });
});

app.post('/api/tip', auth.requireLoginApi, (req, res) => {
  const m = qMatch.get(Number(req.body.match));
  if (!m) return res.status(404).json({ error: 'Unbekanntes Spiel' });
  if (isLocked(m)) return res.status(423).json({ error: 'Tippabgabe beendet' });
  const rawH = req.body.home;
  const rawA = req.body.away;
  const empty = v => v === '' || v == null;
  if (empty(rawH) && empty(rawA)) {
    qDeleteTip.run(req.user.id, m.id);
    return res.json({ ok: true, cleared: true });
  }
  const h = Number(rawH);
  const a = Number(rawA);
  if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > 99 || a > 99) {
    return res.status(400).json({ error: 'Ungültiger Tipp' });
  }
  qUpsertTip.run(req.user.id, m.id, h, a);
  res.json({ ok: true });
});

// ---------- Bonustipps ----------

app.post('/api/bonus', auth.requireLoginApi, (req, res) => {
  if (bonusLocked()) return res.status(423).json({ error: 'Bonustipps sind seit dem Eröffnungsspiel gesperrt' });
  const champion = req.body.champion ? String(req.body.champion) : null;
  if (champion && !teamExists(champion)) return res.status(400).json({ error: 'Unbekanntes Team' });
  let round = req.body.germany_round;
  round = (round === '' || round == null) ? null : Number(round);
  if (round != null && !(Number.isInteger(round) && BONUS_ROUNDS[round])) {
    return res.status(400).json({ error: 'Ungültige Runde' });
  }
  qUpsertBonus.run(req.user.id, champion, round);
  res.json({ ok: true });
});

// ---------- Live-Scores (Polling) ----------

app.get('/api/scores', auth.requireLoginApi, (req, res) => {
  const ms = qMatches.all().map(m => ({
    id: m.id,
    l: isLocked(m) ? 1 : 0,
    s: m.status || 'scheduled',
    h: m.home_score, a: m.away_score,
    fh: m.home_final, fa: m.away_final,
    n: m.result_note || null,
  }));
  const r = bonusResults();
  res.set('Cache-Control', 'no-store');
  res.json({ live: ms.some(x => x.s === 'live'), bl: bonusLocked() ? 1 : 0, champ: r.champion, ger: r.germanyRound, m: ms });
});

// ---------- Spiel-Detail: alle Tipps ----------

app.get('/spiel/:id', auth.requireLogin, (req, res) => {
  const m = qMatch.get(Number(req.params.id));
  if (!m) return res.status(404).send('Spiel nicht gefunden');
  const own = qTip.get(req.user.id, m.id);
  const vm = matchView(m, own);
  let tips = [];
  if (vm.locked) {
    tips = qTipsForMatch.all(m.id).map(t => ({
      username: t.username,
      mine: t.user_id === req.user.id,
      h: t.home_goals,
      a: t.away_goals,
      pts: points(t.home_goals, t.away_goals, m.home_score, m.away_score),
    })).sort((x, y) => (y.pts ?? -1) - (x.pts ?? -1) || x.username.localeCompare(y.username, 'de'));
  }
  res.render('spiel', { title: 'Spiel', active: 'tippen', m: vm, tips });
});

// ---------- Spielplan (Gruppen / K.o.-Runde) ----------

function computeStandings(rawMatches) {
  const table = new Map();
  const ensure = (t) => {
    if (!table.has(t)) {
      table.set(t, { name: teamName(t), flag: teamFlag(t), tbd: isPlaceholder(t), sp: 0, gf: 0, ga: 0, pkt: 0 });
    }
    return table.get(t);
  };
  for (const m of rawMatches) {
    const h = ensure(m.home_team);
    const a = ensure(m.away_team);
    if (m.home_score == null || m.away_score == null) continue;
    h.sp++; a.sp++;
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) h.pkt += 3;
    else if (m.home_score < m.away_score) a.pkt += 3;
    else { h.pkt++; a.pkt++; }
  }
  return [...table.values()].sort((x, y) =>
    y.pkt - x.pkt || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.name.localeCompare(y.name, 'de'));
}

app.get('/spielplan', auth.requireLogin, (req, res) => {
  const all = qMatches.all();

  const groupsMap = new Map();
  for (const m of all) {
    if (m.round > 3 || !m.group_name) continue;
    const key = m.group_name.replace('Group ', '');
    if (!groupsMap.has(key)) groupsMap.set(key, { key, raw: [], matches: [] });
    const g = groupsMap.get(key);
    g.raw.push(m);
    g.matches.push(matchView(m, null));
  }
  const groups = [...groupsMap.values()].sort((a, b) => a.key.localeCompare(b.key));
  groups.forEach(g => { g.standings = computeStandings(g.raw); delete g.raw; });

  const koRounds = [];
  let current = null;
  for (const m of all.filter(m => m.round >= 4)) {
    const label = stageLabel(m);
    if (!current || current.label !== label) {
      current = { label, matches: [] };
      koRounds.push(current);
    }
    current.matches.push(matchView(m, null));
  }

  const lastGroupKickoff = Math.max(...all.filter(m => m.round <= 3).map(m => Date.parse(m.kickoff_utc)));
  res.render('spielplan', {
    title: 'Spielplan', active: 'spielplan', groups, koRounds,
    defaultTab: Date.now() > lastGroupKickoff ? 'ko' : 'gruppen',
  });
});

// ---------- Tabelle ----------

app.get('/tabelle', auth.requireLogin, (req, res) => {
  const locked = bonusLocked();
  const res_ = bonusResults();
  let bonusTips = [];
  if (locked) {
    bonusTips = qAllBonus.all().map(b => ({
      username: b.username,
      mine: b.user_id === req.user.id,
      champion: b.champion,
      round: b.germany_round,
      championHit: res_.champion ? b.champion === res_.champion : null,
      roundHit: res_.germanyRound ? b.germany_round === res_.germanyRound : null,
    }));
  }
  res.render('tabelle', {
    title: 'Tabelle', active: 'tabelle', board: leaderboard(),
    anyLive: qMatches.all().some(m => m.status === 'live'),
    bonusTips, bonusLocked: locked, bonusResults: res_,
  });
});

// ---------- Konto ----------

app.get('/konto', auth.requireLogin, (req, res) => {
  res.render('konto', { title: 'Konto', active: 'konto', ok: req.query.ok || null, err: req.query.err || null });
});

app.post('/konto/passwort', auth.requireLogin, (req, res) => {
  const u = qUserById.get(req.user.id);
  const { current, neu, neu2 } = req.body;
  if (!bcrypt.compareSync(String(current || ''), u.password_hash)) {
    return res.redirect('/konto?err=' + encodeURIComponent('Aktuelles Passwort ist falsch.'));
  }
  if (typeof neu !== 'string' || neu.length < 6) {
    return res.redirect('/konto?err=' + encodeURIComponent('Neues Passwort braucht mindestens 6 Zeichen.'));
  }
  if (neu !== neu2) {
    return res.redirect('/konto?err=' + encodeURIComponent('Passwörter stimmen nicht überein.'));
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(neu, 10), u.id);
  auth.deleteOtherSessions(u.id, req.user.token);
  res.redirect('/konto?ok=' + encodeURIComponent('Passwort geändert.'));
});

// ---------- Admin ----------

app.get('/admin', auth.requireAdmin, (req, res) => {
  const board = new Map(leaderboard().map(r => [r.id, r]));
  const users = qUsers.all().map(u => ({
    ...u,
    stats: board.get(u.id) || { total: 0, tips: 0 },
  }));
  res.render('admin', {
    title: 'Admin', active: 'admin', users, feedUrl: FEED_URL,
    teamOptions: teamOptions(),
    roundOptions: Object.entries(BONUS_ROUNDS).map(([v, l]) => ({ value: Number(v), label: l })),
    bonusResults: bonusResults(),
    ok: req.query.ok || null, err: req.query.err || null,
  });
});

app.post('/admin/users', auth.requireAdmin, (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const isAdmin = req.body.is_admin === '1' ? 1 : 0;
  if (!/^[\p{L}\p{N}._\- ]{2,30}$/u.test(username)) {
    return res.redirect('/admin?err=' + encodeURIComponent('Benutzername: 2–30 Zeichen (Buchstaben, Zahlen, . _ -).'));
  }
  if (password.length < 6) {
    return res.redirect('/admin?err=' + encodeURIComponent('Passwort braucht mindestens 6 Zeichen.'));
  }
  try {
    db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)')
      .run(username, bcrypt.hashSync(password, 10), isAdmin);
  } catch (e) {
    return res.redirect('/admin?err=' + encodeURIComponent('Benutzername ist schon vergeben.'));
  }
  res.redirect('/admin?ok=' + encodeURIComponent(`Account „${username}“ angelegt.`));
});

app.post('/admin/users/:id/passwort', auth.requireAdmin, (req, res) => {
  const u = qUserById.get(Number(req.params.id));
  if (!u) return res.redirect('/admin?err=' + encodeURIComponent('Nutzer nicht gefunden.'));
  const password = String(req.body.password || '');
  if (password.length < 6) {
    return res.redirect('/admin?err=' + encodeURIComponent('Passwort braucht mindestens 6 Zeichen.'));
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), u.id);
  auth.deleteUserSessions(u.id);
  res.redirect('/admin?ok=' + encodeURIComponent(`Passwort für „${u.username}“ zurückgesetzt.`));
});

app.post('/admin/users/:id/loeschen', auth.requireAdmin, (req, res) => {
  const u = qUserById.get(Number(req.params.id));
  if (!u) return res.redirect('/admin?err=' + encodeURIComponent('Nutzer nicht gefunden.'));
  if (u.id === req.user.id) {
    return res.redirect('/admin?err=' + encodeURIComponent('Du kannst dich nicht selbst löschen.'));
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  res.redirect('/admin?ok=' + encodeURIComponent(`Account „${u.username}“ gelöscht.`));
});

app.post('/admin/sync', auth.requireAdmin, async (req, res) => {
  try {
    const r = await syncFromFeed();
    res.redirect('/admin?ok=' + encodeURIComponent(
      `Sync ok: ${r.scoresUpdated} Ergebnisse und ${r.metaUpdated} Spieldaten (Teams/Zeiten) aktualisiert.`));
  } catch (e) {
    res.redirect('/admin?err=' + encodeURIComponent('Sync fehlgeschlagen: ' + e.message));
  }
});

app.post('/admin/bonus', auth.requireAdmin, (req, res) => {
  const champion = req.body.champion ? String(req.body.champion) : null;
  if (champion && !teamExists(champion)) {
    return res.redirect('/admin?err=' + encodeURIComponent('Unbekanntes Team.'));
  }
  let round = req.body.germany_round;
  round = (round === '' || round == null) ? null : Number(round);
  if (round != null && !BONUS_ROUNDS[round]) {
    return res.redirect('/admin?err=' + encodeURIComponent('Ungültige Runde.'));
  }
  setSetting('champion_result', champion);
  setSetting('germany_round_result', round);
  res.redirect('/admin?ok=' + encodeURIComponent('Bonustipp-Auswertung gespeichert.'));
});

app.get('/admin/spiele', auth.requireAdmin, (req, res) => {
  const rounds = [];
  let current = null;
  for (const m of qMatches.all()) {
    const label = roundLabel(m.round, m.id);
    if (!current || current.label !== label) {
      current = { label, matches: [] };
      rounds.push(current);
    }
    current.matches.push({
      ...m,
      dayShort: fmtDayShort(m.kickoff_utc),
      time: fmtTime(m.kickoff_utc),
      locked: isLocked(m),
    });
  }
  res.render('admin-spiele', {
    title: 'Spiele verwalten', active: 'admin', rounds,
    ok: req.query.ok || null, err: req.query.err || null,
  });
});

app.post('/admin/spiele/:id', auth.requireAdmin, (req, res) => {
  const m = qMatch.get(Number(req.params.id));
  if (!m) return res.redirect('/admin/spiele?err=' + encodeURIComponent('Spiel nicht gefunden.'));
  const back = (msg, isErr) =>
    res.redirect(`/admin/spiele?${isErr ? 'err' : 'ok'}=${encodeURIComponent(msg)}#m${m.id}`);

  const homeTeam = String(req.body.home_team || '').trim();
  const awayTeam = String(req.body.away_team || '').trim();
  if (!homeTeam || !awayTeam) return back('Team-Namen dürfen nicht leer sein.', true);

  const parseScorePair = (rawH, rawA, label) => {
    const sH = String(rawH ?? '').trim();
    const sA = String(rawA ?? '').trim();
    if (sH === '' && sA === '') return { h: null, a: null };
    const h = Number(sH);
    const a = Number(sA);
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > 99 || a > 99) {
      throw new Error(`${label}: beide Felder mit Zahlen 0–99 füllen (oder beide leer lassen).`);
    }
    return { h, a };
  };

  let score, finalScore;
  try {
    score = parseScorePair(req.body.hs, req.body.as, 'Ergebnis');
    finalScore = parseScorePair(req.body.hf, req.body.af, 'Endstand n. V.');
  } catch (e) {
    return back(e.message, true);
  }
  const status = score.h == null ? 'scheduled' : (req.body.live === '1' ? 'live' : 'finished');
  const note = String(req.body.note || '').trim().slice(0, 40) || null;

  db.prepare(`
    UPDATE matches SET home_team = ?, away_team = ?, home_score = ?, away_score = ?,
                       home_final = ?, away_final = ?, result_note = ?, status = ?
    WHERE id = ?
  `).run(homeTeam, awayTeam, score.h, score.a, finalScore.h, finalScore.a, note, status, m.id);
  back(`Spiel #${m.id} gespeichert.`);
});

// ---------- Sonstiges ----------

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.use((req, res) => res.status(404).send('Seite nicht gefunden'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Interner Fehler');
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`WM-2026-Tippspiel läuft auf Port ${port}`);
  startAutoSync();
});
