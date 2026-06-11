# ⚽ WM 2026 Tippspiel

Schlankes, mobiles Tippspiel zur Fußball-WM 2026 (11. Juni – 19. Juli 2026, USA/Kanada/Mexiko).
Node.js + Express + SQLite, serverseitig gerendert, ohne externe Frontend-Frameworks.

## Features

- **Alle 104 Spiele** mit echtem Spielplan (Quelle: fixturedownload.com), Anzeige in deutscher Zeit (Europe/Berlin)
- **Tippen bis zum Anpfiff** – danach ist der Tipp serverseitig gesperrt
- **Automatisches Speichern** beim Eintippen (kein Speichern-Button nötig)
- **Live-Scoring:** Während laufender Spiele werden Zwischenstände regelmäßig aus dem Feed
  geholt (`LIVE_SYNC_MINUTES`); Spielkarten, Spielplan und Rangliste aktualisieren sich
  automatisch im Browser – die Punkte rechnen Live-Stände mit
- **Ergebnis-Anzeige:** Auf jeder Spielkarte sieht man eigenen Tipp, Ergebnis und Punkte;
  bei K.o.-Spielen zusätzlich 90-Minuten-Ergebnis und Endstand (n.V./i.E.) – gewertet wird
  immer das 90-Minuten-Ergebnis
- **Spielplan-Ansicht:** Übersicht nach Gruppen (mit Live-Gruppentabellen) und K.o.-Runde
- **Filter-Tabs** beim Tippen: Offen (Standard), Heute, Morgen, Nicht getippt, Gespielt, Alle
- **Bonustipps** (je 20 Punkte, änderbar bis zum Eröffnungsspiel): Wer wird Weltmeister?
  Bis zu welcher Runde kommt Deutschland? (Finale = höchste Stufe, Sieg egal)
- **Tipps der anderen** (auch Bonustipps) werden erst nach Anpfiff sichtbar
- **Rangliste** mit Punktewertung: 4 (exakt) / 3 (Tordifferenz) / 2 (Tendenz) / 0 + Bonuspunkte
- **Kein Self-Service:** Accounts legt ausschließlich der Admin an, keine Registrierung
- **Ergebnis-Sync:** Ergebnisse und die Team-Namen der K.o.-Runde werden per Knopfdruck
  (oder automatisch via `AUTO_SYNC_HOURS`/`LIVE_SYNC_MINUTES`) aus dem Feed geholt;
  manuelles Eintragen geht auch
- Mobile-first (helles Design, Bottom-Navigation, große Touch-Ziele), funktioniert auch am Desktop

Gewertet wird das Ergebnis nach 90 Minuten (+ Nachspielzeit) – in der K.o.-Runde kann man
also auch ein Unentschieden tippen. Bei Verlängerung trägt der Admin das 90-Minuten-Ergebnis
(für die Punkte) und den Endstand (zur Anzeige) getrennt ein.

## Lokal starten (Entwicklung)

```bash
npm install
ADMIN_PASSWORD=geheim123 npm start
# http://localhost:3000 – Login: admin / geheim123
```

Ohne `ADMIN_PASSWORD` wird beim allerersten Start ein Zufallspasswort generiert und in der
Konsole ausgegeben. Die SQLite-Datenbank liegt in `data/tippspiel.db`.

## Deployment mit Docker (hinter nginx)

Bei jedem Push auf `main` baut GitHub Actions automatisch ein Multi-Arch-Image
(amd64 + arm64) und veröffentlicht es als `ghcr.io/erikenglerdev/wm-2026:latest`
(siehe [.github/workflows/docker.yml](.github/workflows/docker.yml)).

Auf dem Server reicht damit die `docker-compose.yml` (plus ggf. `.env`):

```bash
ADMIN_PASSWORD=geheim123 docker compose up -d   # zieht das Image von ghcr.io
```

Die App lauscht dann nur auf `127.0.0.1:3000`. Die Datenbank liegt im benannten Volume
`tippspiel-data` und überlebt Updates.

Falls das Paket auf ghcr.io nach dem ersten Workflow-Lauf nicht öffentlich ist
(`docker pull` schlägt ohne Login fehl): auf GitHub unter
**Packages → wm-2026 → Package settings → Change visibility** einmalig auf *Public* stellen.

Lokal bauen statt Image ziehen: in der `docker-compose.yml` die `image:`-Zeile
auskommentieren und `build: .` aktivieren, dann `docker compose up -d --build`.

### nginx-Beispiel (SSL macht nginx)

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name tippspiel.example.de;

    ssl_certificate     /etc/letsencrypt/live/tippspiel.example.de/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tippspiel.example.de/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

server {
    listen 80;
    server_name tippspiel.example.de;
    return 301 https://$host$request_uri;
}
```

Wichtig: `X-Forwarded-Proto` muss gesetzt sein – nur dann markiert die App ihr
Session-Cookie als `Secure` (sie steht mit `trust proxy` hinter genau einem Proxy).

### Updates einspielen

```bash
docker compose pull
docker compose up -d   # Volume bleibt, Tipps/Nutzer bleiben erhalten
```

### Backup

```bash
docker compose cp tippspiel:/data/tippspiel.db ./backup-$(date +%F).db
```

## Konfiguration (Umgebungsvariablen)

| Variable          | Default                                  | Bedeutung                                            |
| ----------------- | ---------------------------------------- | ---------------------------------------------------- |
| `PORT`            | `3000`                                   | HTTP-Port                                            |
| `DB_PATH`         | `data/tippspiel.db` (Docker: `/data/…`)  | Pfad zur SQLite-Datenbank                            |
| `ADMIN_USER`      | `admin`                                  | Benutzername des initialen Admins (nur erster Start) |
| `ADMIN_PASSWORD`  | _(generiert)_                            | Passwort des initialen Admins (nur erster Start)     |
| `TZ_DISPLAY`      | `Europe/Berlin`                          | Zeitzone für die Anzeige der Anstoßzeiten            |
| `AUTO_SYNC_HOURS` | `0` (Compose: `6`)                       | Ergebnis-Sync-Intervall in Stunden, `0` = aus        |
| `LIVE_SYNC_MINUTES` | `0` (Compose: `2`)                     | Sync-Intervall in Minuten während laufender Spiele   |
| `FEED_URL`        | fixturedownload.com (WM 2026)            | Quelle für Spielplan-/Ergebnis-Sync                  |

## Ablauf für den Spielleiter

1. Als `admin` einloggen → **Admin** → Accounts für alle Mitspieler anlegen
   (Start-Passwort persönlich weitergeben; jeder kann es unter „Konto“ ändern).
2. Während des Turniers: Ergebnisse kommen automatisch per Sync (alle 6 h, während
   laufender Spiele alle 2 min als Live-Stand) oder per Knopf „Jetzt synchronisieren“.
   Notfalls unter „Spiele manuell bearbeiten“ eintragen.
3. Nach der Gruppenphase füllt der Sync auch die Paarungen der K.o.-Runde automatisch.
4. Bei K.o.-Spielen mit Verlängerung: 90-Minuten-Ergebnis prüfen/korrigieren (zählt für
   die Punkte) und Endstand + Notiz („n.V.“, „5:4 i.E.“) eintragen.
5. Nach dem Finale unter „Admin → Bonustipps auswerten“ Weltmeister und Deutschland-Runde
   setzen – die 20-Punkte-Boni landen automatisch in der Tabelle.

## Technik

- Express 4, EJS-Templates, better-sqlite3 (WAL-Modus), bcryptjs
- Sessions als zufällige Tokens in der DB, Cookie `HttpOnly` + `SameSite=Lax` (+ `Secure` hinter HTTPS)
- Login-Brute-Force-Bremse (15 Versuche / 15 min pro IP)
- Tippsperre wird serverseitig anhand der Anstoßzeit (UTC) geprüft
