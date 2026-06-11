'use strict';

// Punktevergabe (klassisches Tippspiel-Schema):
//   4 Punkte – exaktes Ergebnis
//   3 Punkte – richtige Tordifferenz bei Sieg (z. B. 2:1 getippt, 3:2 gespielt)
//   2 Punkte – richtige Tendenz (Sieger bzw. Unentschieden richtig)
//   0 Punkte – falsche Tendenz
// Gewertet wird das Ergebnis nach regulärer Spielzeit (90 Min. + Nachspielzeit).
const POINTS = { exact: 4, diff: 3, tendency: 2, wrong: 0 };

function points(tipHome, tipAway, resHome, resAway) {
  if (tipHome == null || tipAway == null || resHome == null || resAway == null) return null;
  if (tipHome === resHome && tipAway === resAway) return POINTS.exact;
  const tipDiff = tipHome - tipAway;
  const resDiff = resHome - resAway;
  if (Math.sign(tipDiff) !== Math.sign(resDiff)) return POINTS.wrong;
  if (tipDiff !== 0 && tipDiff === resDiff) return POINTS.diff;
  return POINTS.tendency;
}

// Bonustipps (Weltmeister, Deutschland-Runde): je 20 Punkte
const BONUS_POINTS = 20;

module.exports = { points, POINTS, BONUS_POINTS };
