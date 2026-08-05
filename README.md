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
- KI-Kommandanten erhalten pro Seed eindeutige, humorvolle Parodienamen.
- Eine farbcodierte Rangliste ordnet alle Parteien nach kontrollierten Territorien und zeigt ihre Gesamttruppenstärke.
- Jede Einheit würfelt einen W6. Die höhere Summe gewinnt; Gleichstand gewinnt die Verteidigung.
- Infanterie verteidigt Wald und Städte, Panzer greifen im Flachland stärker an, Artillerie unterstützt Angriffe.
- Nach dem Zug werden Verstärkungen anhand der größten verbundenen Gebietsgruppe und kontrollierter Städte verteilt.
- Die Nachschubstärke ist vor Spielbeginn zwischen dem bisherigen Niveau sowie 1,5×, 2× und 3× wählbar.
- Taktische Karten sind optional: Jede Partei zieht zu Zugbeginn eine Karte und kann Nachschub, Verlegungen, Kampfboni, Befestigungen, Würfelglück und Mobilmachung kombinieren.
- Wähle zwischen totaler Eroberung und dem Ausschalten gegnerischer Hauptquartiere.
- Jeder Spieler beginnt mit einem kompakten Heimatkern; die Starttruppen können in Runde 1 kein gegnerisches Hauptquartier erreichen.
- Jedes Territorium besteht aus mindestens vier zusammenhängenden Hexfeldern.
- Die zuletzt gestarteten Partieeinstellungen werden beim nächsten Besuch wieder vorausgewählt.
- Eine noch ungespielte Startkarte kann direkt verworfen und mit denselben Einstellungen neu ausgewürfelt werden.
- Partien werden automatisch im Browser gespeichert. Derselbe Seed erzeugt dieselbe Karte.

---

- One human plays against 1–5 AI factions across 36, 60, or 90 regions.
- AI commanders receive unique, humorous parody names determined by the seed.
- A color-coded ranking orders every faction by controlled territories and shows its total troop strength.
- Every unit rolls one D6. The higher total wins; ties favor the defender.
- Infantry defends forests and cities, armor attacks plains more effectively, and artillery supports attacks.
- Reinforcements depend on the largest connected territory group and controlled cities.
- Optional tactical cards provide supply, redeployment, combat support, fortifications, lucky rerolls, and mobilization; one card is drawn at the start of each turn.
- Choose total conquest or headquarters elimination.
- Every faction starts with a compact home cluster; starting armies cannot reach an enemy headquarters during round one.
- Every territory contains at least four connected hex cells.
- The most recently used match settings are preselected on the next visit.
- An untouched opening map can be rejected and rerolled immediately with the same match settings.
- Matches are autosaved in the browser. The same seed creates the same map.

## Steuerung / Controls

- Eigene Region und danach ein angrenzendes gegnerisches Ziel wählen.
- Der Angriff beginnt direkt nach der Zielauswahl; mit `Esc` lässt sich eine offene Auswahl löschen.
- Legale Ziele zeigen den relativen Kampfbonus als `+N`, `−N` oder `±0` direkt auf der Karte.
- Einheitengrafiken, Typanzahlen, Gesamtstärke und Geländezeichen liegen direkt auf eigenen Hexfeldern des Territoriums; beim Herauszoomen wird die Darstellung automatisch reduziert.
- Während die Würfel noch rollen, kann bereits der nächste Angriff gewählt werden; er ersetzt die laufende Kampfanimation.
- KI-Angriffe zeigen während der Würfelanimation die bisherigen Truppen sowie eine animierte Richtungslinie zwischen Ausgang und Ziel.
- Karten werden ohne Bestätigungsdialog direkt über die hervorgehobenen Zielgebiete gespielt und können gestapelt werden.
- Karte mit Maus/Finger verschieben, mit Mausrad oder den Schaltflächen zoomen.
- `F` passt die gesamte Karte in die Ansicht ein.
- Der Lautsprecher im Kopfbereich schaltet Soundeffekte und Schlachtfeldatmosphäre dauerhaft an oder aus.

## Entwicklung / Development

```bash
npm run check
npm test
```

Die Tests verwenden ausschließlich den in Node.js integrierten Test-Runner.

Die transparenten Einheiten-Sprites unter `assets/units/` werden direkt auf der Karte und in der detaillierten Gebietsanzeige verwendet und sind Bestandteil dieses Projekts.

## Inspiration

Als spielerische Vorlage und Inspiration dienten die Browser-Strategiespiele **„World Wars“** und **„World Wars 2“** (auch zusammen als **„World Wars 1+2“** bezeichnet), insbesondere ihr direkter Ablauf aus Gebietsauswahl, Angriff und würfelbasierter Eroberung.

Dicefront: Dominion ist eine eigenständige Neuimplementierung mit eigener Kartengenerierung, Gestaltung, Spiellogik und eigenen Assets. Das Projekt steht in keiner offiziellen Verbindung zu den ursprünglichen Spielen oder deren Rechteinhabern.

The browser strategy games **“World Wars”** and **“World Wars 2”**—also referred to together as **“World Wars 1+2”**—served as gameplay references and inspiration, particularly for their direct territory-selection and dice-based conquest loop.

Dicefront: Dominion is an independent reimplementation with its own map generation, visual design, game logic, and assets. It is not officially affiliated with the original games or their rights holders.

## Lizenz / License

[MIT](LICENSE)
