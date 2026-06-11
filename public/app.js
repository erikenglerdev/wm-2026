(function () {
  'use strict';

  // ---- Tipps automatisch speichern (debounced) ----
  var timers = {};

  document.addEventListener('input', function (e) {
    if (!e.target.classList || !e.target.classList.contains('gin') || !e.target.dataset.match) return;
    var id = e.target.dataset.match;
    clearTimeout(timers[id]);
    setState(id, 'Speichern…', true);
    timers[id] = setTimeout(function () { save(id); }, 700);
  });

  function inputs(id) {
    return document.querySelectorAll('.gin[data-match="' + id + '"]');
  }

  function setState(id, text, busy) {
    var el = document.querySelector('.savestate[data-match="' + id + '"]');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('busy', !!busy);
  }

  function save(id) {
    var vals = [];
    inputs(id).forEach(function (i) { vals.push(i.value.trim()); });
    var h = vals[0], a = vals[1];
    if ((h === '') !== (a === '')) {
      setState(id, 'Beide Felder ausfüllen', true);
      return;
    }
    fetch('/api/tip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match: Number(id), home: h, away: a }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) {
          setState(id, j.cleared ? 'Tipp gelöscht' : '✓ Gespeichert');
          var card = document.querySelector('article.match[data-id="' + id + '"]');
          if (card) card.dataset.tipped = j.cleared ? '0' : '1';
        } else if (r.status === 423) {
          setState(id, '🔒 Tippabgabe beendet');
          inputs(id).forEach(function (i) { i.disabled = true; });
        } else if (r.status === 401) {
          location.href = '/login';
        } else {
          setState(id, j.error || 'Fehler beim Speichern', true);
        }
      });
    }).catch(function () {
      setState(id, '⚠ Keine Verbindung', true);
    });
  }

  // ---- Bonustipps speichern ----
  var champSel = document.getElementById('bonus-champion');
  var gerSel = document.getElementById('bonus-germany');

  function saveBonus() {
    var state = document.getElementById('bonus-state');
    if (state) state.textContent = 'Speichern… ';
    fetch('/api/bonus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        champion: champSel ? champSel.value : '',
        germany_round: gerSel ? gerSel.value : '',
      }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!state) return;
        if (r.ok) state.textContent = '✓ Gespeichert. ';
        else state.textContent = (j.error || 'Fehler') + '. ';
      });
    }).catch(function () {
      if (state) state.textContent = '⚠ Keine Verbindung. ';
    });
  }
  if (champSel) champSel.addEventListener('change', saveBonus);
  if (gerSel) gerSel.addEventListener('change', saveBonus);

  // ---- Filter-Chips (Tippen-Seite), Standard: "Offen" ----
  var chips = document.querySelectorAll('.chip[data-filter]');
  if (chips.length) {
    var saved = 'offen';
    try { saved = localStorage.getItem('tippFilter') || 'offen'; } catch (e) {}
    var validChip = document.querySelector('.chip[data-filter="' + saved + '"]') ? saved : 'offen';
    selectFilter(validChip);

    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        try { localStorage.setItem('tippFilter', c.dataset.filter); } catch (e) {}
        selectFilter(c.dataset.filter);
      });
    });
  }

  function selectFilter(f) {
    chips.forEach(function (x) { x.classList.toggle('on', x.dataset.filter === f); });
    var visible = 0;
    document.querySelectorAll('article.match').forEach(function (m) {
      var st = m.dataset.state;
      var show =
        f === 'alle' ||
        (f === 'offen' && st === 'open') ||
        (f === 'heute' && m.dataset.today === '1') ||
        (f === 'morgen' && m.dataset.tomorrow === '1') ||
        (f === 'ungetippt' && st === 'open' && m.dataset.tipped === '0') ||
        (f === 'beendet' && st !== 'open');
      m.hidden = !show;
      if (show) visible++;
    });
    document.querySelectorAll('.datehead').forEach(function (h) {
      var el = h.nextElementSibling;
      var any = false;
      while (el && !el.classList.contains('datehead')) {
        if (el.matches && el.matches('article.match') && !el.hidden) any = true;
        el = el.nextElementSibling;
      }
      h.hidden = !any;
    });
    var empty = document.querySelector('.filter-empty');
    if (empty) empty.hidden = visible > 0;
  }

  // ---- Spielplan: Gruppen / K.o. umschalten ----
  document.querySelectorAll('.chip[data-plan]').forEach(function (c) {
    c.addEventListener('click', function () {
      document.querySelectorAll('.chip[data-plan]').forEach(function (x) { x.classList.toggle('on', x === c); });
      document.getElementById('plan-gruppen').hidden = c.dataset.plan !== 'gruppen';
      document.getElementById('plan-ko').hidden = c.dataset.plan !== 'ko';
    });
  });

  // ---- Live-Aktualisierung: Daten pollen, bei Änderung neu laden ----
  // (Scores, Status, Tippsperren – Seite lädt nur neu, wenn sich wirklich
  // etwas geändert hat und der Nutzer gerade nicht tippt.)
  if (document.querySelector('nav.bottom')) {
    var baseline = null;
    var pollEvery = 45000;

    var poll = function () {
      fetch('/api/scores', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (t) {
          if (t == null) return;
          try { pollEvery = JSON.parse(t).live ? 30000 : 60000; } catch (e) {}
          if (baseline === null) { baseline = t; return; }
          if (t === baseline) return;
          var ae = document.activeElement;
          var typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA');
          if (!typing) {
            baseline = t;
            location.reload();
          }
        })
        .catch(function () {});
    };

    var schedule = function () {
      setTimeout(function () { poll(); schedule(); }, pollEvery);
    };
    poll();
    schedule();
  }

  // ---- Lösch-Bestätigungen ----
  document.querySelectorAll('form.confirm').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!confirm(f.dataset.msg || 'Wirklich?')) e.preventDefault();
    });
  });
})();
