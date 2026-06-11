'use strict';

// Event-Bus für Live-Updates: Wer Spieldaten ändert (Sync, Admin), ruft
// notifyChange() auf – alle offenen SSE-Verbindungen bekommen sofort den
// neuen Stand gepusht.
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(0); // eine Verbindung pro Gerät, Anzahl unbegrenzt

function notifyChange() {
  bus.emit('update');
}

module.exports = { bus, notifyChange };
