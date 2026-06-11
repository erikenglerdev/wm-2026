'use strict';

const { db, feedDateToIso } = require('./db');
const { notifyChange } = require('./live');

const FEED_URL = process.env.FEED_URL || 'https://fixturedownload.com/feed/json/fifa-world-cup-2026';

// Wie lange nach Anpfiff ein Spiel als "läuft evtl. noch" gilt
const LIVE_WINDOW_MS = { group: 3 * 3600 * 1000, ko: 4 * 3600 * 1000 };

const qGet = db.prepare('SELECT * FROM matches WHERE id = ?');
const qAll = db.prepare('SELECT id, round, kickoff_utc, status FROM matches');
const qUpdMeta = db.prepare('UPDATE matches SET home_team = ?, away_team = ?, kickoff_utc = ?, venue = ? WHERE id = ?');
const qUpdScore = db.prepare('UPDATE matches SET home_score = ?, away_score = ?, status = ? WHERE id = ?');

function liveWindowMs(round) {
  return round >= 4 ? LIVE_WINDOW_MS.ko : LIVE_WINDOW_MS.group;
}

// Holt den aktuellen Spielplan und überträgt Team-Namen (K.o.-Runde!),
// Anstoßzeiten und Ergebnisse. Spielstände während des Live-Fensters werden
// als Zwischenstand (status=live) übernommen, danach als Endstand.
// Bereits abgeschlossene K.o.-Spiele werden nicht mehr angefasst, damit ein
// manuell korrigiertes 90-Minuten-Ergebnis (bei Verlängerung) erhalten bleibt.
async function syncFromFeed() {
  const res = await fetch(FEED_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { 'user-agent': 'wm2026-tippspiel' },
  });
  if (!res.ok) throw new Error(`Feed antwortet mit HTTP ${res.status}`);
  const data = await res.json();

  let metaUpdated = 0;
  let scoresUpdated = 0;
  const now = Date.now();
  db.transaction(() => {
    for (const f of data) {
      const m = qGet.get(f.MatchNumber);
      if (!m) continue;

      const kickoff = feedDateToIso(f.DateUtc);
      if (m.home_team !== f.HomeTeam || m.away_team !== f.AwayTeam || m.kickoff_utc !== kickoff || m.venue !== f.Location) {
        qUpdMeta.run(f.HomeTeam, f.AwayTeam, kickoff, f.Location, m.id);
        metaUpdated++;
      }

      if (f.HomeTeamScore == null || f.AwayTeamScore == null) continue;
      if (m.round >= 4 && m.status === 'finished') continue; // K.o.: manuell Kuratiertes schützen

      const over = f.Winner || now > Date.parse(kickoff) + liveWindowMs(m.round);
      const status = m.status === 'finished' || over ? 'finished' : 'live';
      if (m.home_score !== f.HomeTeamScore || m.away_score !== f.AwayTeamScore || m.status !== status) {
        qUpdScore.run(f.HomeTeamScore, f.AwayTeamScore, status, m.id);
        scoresUpdated++;
      }
    }
  })();
  if (metaUpdated || scoresUpdated) notifyChange();
  return { total: data.length, metaUpdated, scoresUpdated };
}

// Läuft gerade (potenziell) ein Spiel bzw. steht eines kurz bevor?
function inLiveWindow() {
  const now = Date.now();
  return qAll.all().some(m => {
    if (m.status === 'finished') return false;
    const kickoff = Date.parse(m.kickoff_utc);
    return now >= kickoff - 5 * 60 * 1000 && now <= kickoff + liveWindowMs(m.round);
  });
}

// Hintergrund-Sync: im Normalbetrieb alle AUTO_SYNC_HOURS, während laufender
// Spiele alle LIVE_SYNC_MINUTES (Live-Scoring).
function startAutoSync() {
  const baseHours = Number(process.env.AUTO_SYNC_HOURS || 0);
  const liveMinutes = Number(process.env.LIVE_SYNC_MINUTES || 0);
  if (!baseHours && !liveMinutes) return;

  let lastSync = 0;
  const tick = async () => {
    const interval = inLiveWindow() && liveMinutes
      ? liveMinutes * 60 * 1000
      : (baseHours ? baseHours * 3600 * 1000 : Infinity);
    if (Date.now() - lastSync < interval) return;
    lastSync = Date.now();
    try {
      const r = await syncFromFeed();
      if (r.scoresUpdated || r.metaUpdated) {
        console.log(`Auto-Sync: ${r.scoresUpdated} Ergebnisse, ${r.metaUpdated} Spieldaten aktualisiert`);
      }
    } catch (err) {
      console.error('Auto-Sync fehlgeschlagen:', err.message);
    }
  };
  setTimeout(tick, 5 * 1000);
  setInterval(tick, 60 * 1000).unref();
  console.log(`Auto-Sync aktiv: alle ${baseHours} h, während Live-Spielen alle ${liveMinutes} min (${FEED_URL})`);
}

module.exports = { syncFromFeed, startAutoSync, FEED_URL };
