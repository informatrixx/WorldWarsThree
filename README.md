# Dicefront: Dominion

Ein eigenständiges, rundenbasiertes Browser-Strategiespiel: Erobere eine prozedural erzeugte Karte, nutze Gelände- und Klassenboni und schalte gegnerische Hauptquartiere aus.

An independent turn-based browser strategy game: conquer a procedurally generated map, use terrain and class bonuses, and eliminate enemy headquarters.

## Spielen / Play

Die veröffentlichte Version läuft unter:

**https://informatrixx.github.io/WorldWarsThree/**

Lokal genügt ein beliebiger statischer Webserver:

```bash
python3 -m http.server 8080
```

Danach `http://localhost:8080` öffnen. Es gibt keinen Build-Schritt und keine Laufzeitabhängigkeiten.

Open `http://localhost:8080` afterwards. There is no build step and there are no runtime dependencies.

## Regeln / Rules

- Ein Mensch spielt gegen 1–5 KI-Parteien auf 36, 60 oder 90 Regionen.
- Jede Einheit würfelt einen W6. Die höhere Summe gewinnt; Gleichstand gewinnt die Verteidigung.
- Infanterie verteidigt Wald und Städte, Panzer greifen im Flachland stärker an, Artillerie unterstützt Angriffe.
- Nach dem Zug werden Verstärkungen anhand der größten verbundenen Gebietsgruppe und kontrollierter Städte verteilt.
- Die Nachschubstärke ist vor Spielbeginn zwischen dem bisherigen Niveau sowie 1,5×, 2× und 3× wählbar.
- Wähle zwischen totaler Eroberung und dem Ausschalten gegnerischer Hauptquartiere.
- Jeder Spieler beginnt mit einem kompakten Heimatkern; die Starttruppen können in Runde 1 kein gegnerisches Hauptquartier erreichen.
- Partien werden automatisch im Browser gespeichert. Derselbe Seed erzeugt dieselbe Karte.

---

- One human plays against 1–5 AI factions across 36, 60, or 90 regions.
- Every unit rolls one D6. The higher total wins; ties favor the defender.
- Infantry defends forests and cities, armor attacks plains more effectively, and artillery supports attacks.
- Reinforcements depend on the largest connected territory group and controlled cities.
- Choose total conquest or headquarters elimination.
- Every faction starts with a compact home cluster; starting armies cannot reach an enemy headquarters during round one.
- Matches are autosaved in the browser. The same seed creates the same map.

## Steuerung / Controls

- Eigene Region und danach ein angrenzendes gegnerisches Ziel wählen.
- Der Angriff beginnt direkt nach der Zielauswahl; mit `Esc` lässt sich eine offene Auswahl löschen.
- Legale Ziele zeigen den relativen Kampfbonus als `+N`, `−N` oder `±0` direkt auf der Karte.
- Jede Einheit erscheint als eigenes, überlappend gestapeltes Symbol direkt im kontrollierten Gebiet.
- Während die Würfel noch rollen, kann bereits der nächste Angriff gewählt werden; er ersetzt die laufende Kampfanimation.
- Karte mit Maus/Finger verschieben, mit Mausrad oder den Schaltflächen zoomen.
- `F` passt die gesamte Karte in die Ansicht ein.
- Der Lautsprecher im Kopfbereich schaltet Soundeffekte und Schlachtfeldatmosphäre dauerhaft an oder aus.

## Entwicklung / Development

```bash
npm run check
npm test
```

Die Tests verwenden ausschließlich den in Node.js integrierten Test-Runner.

Die eigenständigen Einheiten-Sprites unter `assets/units/` sind für die Karte optimierte transparente PNG-Dateien und Bestandteil dieses Projekts.

## Lizenz / License

[MIT](LICENSE)
