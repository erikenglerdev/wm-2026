'use strict';

// Feed-Name (englisch) -> deutscher Anzeigename + Flagge
const TEAMS = {
  'Algeria': { de: 'Algerien', flag: '🇩🇿' },
  'Argentina': { de: 'Argentinien', flag: '🇦🇷' },
  'Australia': { de: 'Australien', flag: '🇦🇺' },
  'Austria': { de: 'Österreich', flag: '🇦🇹' },
  'Belgium': { de: 'Belgien', flag: '🇧🇪' },
  'Bosnia and Herzegovina': { de: 'Bosnien-Herzeg.', flag: '🇧🇦' },
  'Brazil': { de: 'Brasilien', flag: '🇧🇷' },
  'Cabo Verde': { de: 'Kap Verde', flag: '🇨🇻' },
  'Canada': { de: 'Kanada', flag: '🇨🇦' },
  'Colombia': { de: 'Kolumbien', flag: '🇨🇴' },
  'Congo DR': { de: 'DR Kongo', flag: '🇨🇩' },
  'Croatia': { de: 'Kroatien', flag: '🇭🇷' },
  'Curaçao': { de: 'Curaçao', flag: '🇨🇼' },
  'Czechia': { de: 'Tschechien', flag: '🇨🇿' },
  "Côte d'Ivoire": { de: 'Elfenbeinküste', flag: '🇨🇮' },
  'Ecuador': { de: 'Ecuador', flag: '🇪🇨' },
  'Egypt': { de: 'Ägypten', flag: '🇪🇬' },
  'England': { de: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  'France': { de: 'Frankreich', flag: '🇫🇷' },
  'Germany': { de: 'Deutschland', flag: '🇩🇪' },
  'Ghana': { de: 'Ghana', flag: '🇬🇭' },
  'Haiti': { de: 'Haiti', flag: '🇭🇹' },
  'IR Iran': { de: 'Iran', flag: '🇮🇷' },
  'Iraq': { de: 'Irak', flag: '🇮🇶' },
  'Japan': { de: 'Japan', flag: '🇯🇵' },
  'Jordan': { de: 'Jordanien', flag: '🇯🇴' },
  'Korea Republic': { de: 'Südkorea', flag: '🇰🇷' },
  'Mexico': { de: 'Mexiko', flag: '🇲🇽' },
  'Morocco': { de: 'Marokko', flag: '🇲🇦' },
  'Netherlands': { de: 'Niederlande', flag: '🇳🇱' },
  'New Zealand': { de: 'Neuseeland', flag: '🇳🇿' },
  'Norway': { de: 'Norwegen', flag: '🇳🇴' },
  'Panama': { de: 'Panama', flag: '🇵🇦' },
  'Paraguay': { de: 'Paraguay', flag: '🇵🇾' },
  'Portugal': { de: 'Portugal', flag: '🇵🇹' },
  'Qatar': { de: 'Katar', flag: '🇶🇦' },
  'Saudi Arabia': { de: 'Saudi-Arabien', flag: '🇸🇦' },
  'Scotland': { de: 'Schottland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  'Senegal': { de: 'Senegal', flag: '🇸🇳' },
  'South Africa': { de: 'Südafrika', flag: '🇿🇦' },
  'Spain': { de: 'Spanien', flag: '🇪🇸' },
  'Sweden': { de: 'Schweden', flag: '🇸🇪' },
  'Switzerland': { de: 'Schweiz', flag: '🇨🇭' },
  'Tunisia': { de: 'Tunesien', flag: '🇹🇳' },
  'Türkiye': { de: 'Türkei', flag: '🇹🇷' },
  'USA': { de: 'USA', flag: '🇺🇸' },
  'Uruguay': { de: 'Uruguay', flag: '🇺🇾' },
  'Uzbekistan': { de: 'Usbekistan', flag: '🇺🇿' },
};

// Platzhalter der K.o.-Runde, z. B. "1A", "2B", "3ABCDF", "To be announced"
function placeholderName(raw) {
  let m = /^1([A-L])$/.exec(raw);
  if (m) return `Sieger Gruppe ${m[1]}`;
  m = /^2([A-L])$/.exec(raw);
  if (m) return `Zweiter Gruppe ${m[1]}`;
  m = /^3([A-L]{2,})$/.exec(raw);
  if (m) return `Dritter ${m[1].split('').join('/')}`;
  if (/^to be announced$/i.test(raw)) return 'Noch offen';
  if (/^winner match (\d+)$/i.test(raw)) return raw.replace(/^winner match (\d+)$/i, 'Sieger Spiel $1');
  if (/^loser match (\d+)$/i.test(raw)) return raw.replace(/^loser match (\d+)$/i, 'Verlierer Spiel $1');
  return null;
}

function teamName(raw) {
  if (TEAMS[raw]) return TEAMS[raw].de;
  return placeholderName(raw) || raw;
}

function teamFlag(raw) {
  return TEAMS[raw] ? TEAMS[raw].flag : '';
}

function isPlaceholder(raw) {
  return !TEAMS[raw] && placeholderName(raw) !== null;
}

// Für den Weltmeister-Bonustipp: alle Teams als Auswahlliste (deutsch sortiert)
function teamOptions() {
  return Object.entries(TEAMS)
    .map(([value, t]) => ({ value, label: t.de }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

function teamExists(raw) {
  return Object.prototype.hasOwnProperty.call(TEAMS, raw);
}

module.exports = { teamName, teamFlag, isPlaceholder, teamOptions, teamExists };
