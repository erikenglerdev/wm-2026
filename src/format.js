'use strict';

const TZ = process.env.TZ_DISPLAY || 'Europe/Berlin';

const dfDay = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const dfDayShort = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TZ });
const dfTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const dfYmd = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ });

const fmtDay = (iso) => dfDay.format(new Date(iso));
const fmtDayShort = (iso) => dfDayShort.format(new Date(iso));
const fmtTime = (iso) => dfTime.format(new Date(iso));
const isToday = (iso) => dfYmd.format(new Date(iso)) === dfYmd.format(new Date());
const isTomorrow = (iso) => dfYmd.format(new Date(iso)) === dfYmd.format(new Date(Date.now() + 24 * 3600 * 1000));

const KO_ROUNDS = { 4: 'Sechzehntelfinale', 5: 'Achtelfinale', 6: 'Viertelfinale', 7: 'Halbfinale' };

function stageLabel(m) {
  if (m.round <= 3) {
    const g = m.group_name ? m.group_name.replace('Group ', 'Gruppe ') : 'Gruppenphase';
    return `${g} · Spieltag ${m.round}`;
  }
  if (KO_ROUNDS[m.round]) return KO_ROUNDS[m.round];
  return m.id === 104 ? 'Finale' : 'Spiel um Platz 3';
}

function roundLabel(round, matchId) {
  if (round <= 3) return `Gruppenphase · Spieltag ${round}`;
  if (KO_ROUNDS[round]) return KO_ROUNDS[round];
  return matchId === 104 ? 'Finale' : 'Spiel um Platz 3 / Finale';
}

// Stufen für den Bonustipp „Bis zu welcher Runde kommt Deutschland?“
// (Werte entsprechen den Rundennummern des Spielplans)
const BONUS_ROUNDS = {
  3: 'Gruppenphase (Aus in der Vorrunde)',
  4: 'Sechzehntelfinale',
  5: 'Achtelfinale',
  6: 'Viertelfinale',
  7: 'Halbfinale (inkl. Spiel um Platz 3)',
  8: 'Finale',
};
const BONUS_ROUNDS_SHORT = {
  3: 'Vorrunde',
  4: '1/16-Finale',
  5: 'Achtelfinale',
  6: 'Viertelfinale',
  7: 'Halbfinale',
  8: 'Finale',
};

module.exports = { fmtDay, fmtDayShort, fmtTime, isToday, isTomorrow, stageLabel, roundLabel, BONUS_ROUNDS, BONUS_ROUNDS_SHORT, TZ };
