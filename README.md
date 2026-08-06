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

Für Online-Partien wird zusätzlich der autoritative Node-WebSocket-Server benötigt:

```bash
npm install
npm run server
```

Der Server lauscht standardmäßig auf `127.0.0.1:8787`. Hinter nginx wird `/codex/WorldWarsThree/ws` auf diesen Dienst weitergeleitet. Eine Beispielkonfiguration und ein systemd-Service liegen unter `deploy/`. GitHub Pages stellt nur den lokalen Modus bereit.

Das vollständige Übertragen auf einen SSH-/Rsync-Zielserver übernimmt interaktiv:

```bash
bash deploy/rsync-deploy.sh
```

Das Skript fragt Ziel und SSH-Port ab, merkt sich diese beiden Eingaben lokal für den nächsten Aufruf, überträgt Frontend und Multiplayer-Dateien ohne `--delete` und zeigt danach die notwendigen `npm`, systemd- und nginx-Schritte an. Passwörter und SSH-Schlüssel werden nicht gespeichert; privilegierte Deploy-Befehle werden bewusst nicht automatisch ausgeführt.

Open `http://localhost:8080` afterwards. There is no build step and there are no runtime dependencies.

Online matches additionally require the authoritative Node WebSocket server:

```bash
npm install
npm run server
```

The server listens on `127.0.0.1:8787` by default. Behind nginx, forward `/codex/WorldWarsThree/ws` to that service. Example nginx and systemd files are in `deploy/`. GitHub Pages provides local mode only.

The complete transfer to an SSH/rsync target can be started interactively:

```bash
bash deploy/rsync-deploy.sh
```

The script asks for the target and SSH port, remembers those two inputs locally for the next run, transfers frontend and multiplayer files without `--delete`, then prints the required npm, systemd, and nginx steps. Passwords and SSH keys are not stored; privileged deployment commands are intentionally not run automatically.

## Regeln / Rules

- Ein Mensch spielt gegen 1–5 KI-Parteien auf 36, 60 oder 90 Regionen.
- KI-Kommandanten erhalten pro Seed eindeutige, humorvolle Parodienamen.
- Eine farbcodierte Rangliste ordnet alle Parteien nach kontrollierten Territorien und zeigt ihre Gesamttruppenstärke.
- Jede Einheit würfelt einen W6. Die höhere Summe gewinnt; Gleichstand gewinnt die Verteidigung.
- Infanterie verteidigt Wald und Städte, Panzer greifen im Flachland stärker an, Artillerie unterstützt Angriffe.
- Pioniere, Nachschubtruppen und Scharfschützen erweitern die Klassen: Sie überwinden Sümpfe/Flüsse, verbessern einmalig den Nachschub oder neutralisieren Küsten-Mali und zeigen exakte Siegchancen.
- Jede Partie kann mit keiner, wenigen, normalen oder vielen Flüssen gestartet werden; jeder Fluss wird zufällig durch das Landesinnere geführt und endet an einer automatisch erkannten Küste. Sümpfe erschweren Angriffe und bieten Infanterie Deckung.
- Vor einem Angriff kann optional eine Haltung gewählt werden. Sie stärkt die zugehörige Klasse, gibt aber jedem eingesetzten Würfel einer anderen Klasse −1; vorhandene Gelände- und Klassenboni können diesen Gegenmalus ausgleichen. Eine Region hält höchstens drei Einheitentypen.
- Nach dem Zug werden Verstärkungen anhand der größten verbundenen Gebietsgruppe und kontrollierter Städte verteilt.
- HQs und kontrollierte Städte bilden ein Versorgungsnetz. Abgeschnittene Gebiete erhalten Nachschub erst als Fallback und verteidigen sich mit einem Würfel weniger; die Angriffsstärke bleibt unverändert.
- Die Nachschubstärke ist vor Spielbeginn zwischen dem bisherigen Niveau sowie 1,5×, 2× und 3× wählbar.
- Taktische Karten sind optional: Jede Partei zieht zu Zugbeginn eine Karte und kann Nachschub, Verlegungen, Kampfboni, Befestigungen, Würfelglück, Mobilmachung und später freigeschaltete Versorgungskarten kombinieren.
- Dauerhafte Achievements werden browsergebunden im Profil gespeichert. Sie schalten neue Karten und Skills frei; vor jeder Partie können bis zu zwei Skills (später drei) ausgewählt werden.
- Wähle zwischen totaler Eroberung und dem Ausschalten gegnerischer Hauptquartiere.
- Jeder Spieler beginnt mit einem kompakten Heimatkern; die Starttruppen können in Runde 1 kein gegnerisches Hauptquartier erreichen.
- Jedes Territorium besteht aus mindestens vier zusammenhängenden Hexfeldern.
- Die zuletzt gestarteten Partieeinstellungen werden beim nächsten Besuch wieder vorausgewählt.
- Eine noch ungespielte Startkarte kann direkt verworfen und mit denselben Einstellungen neu ausgewürfelt werden.
- Partien werden automatisch im Browser gespeichert. Derselbe Seed erzeugt dieselbe Karte.
- Online-Räume verwenden einen privaten sechsstelligen Code, Nicknames und Reconnect-Tokens. Nach 60 Sekunden wird ein Zug zunächst übersprungen; beim zweiten Timeout übernimmt die KI.
- Beim Erstellen eines Online-Raums legt der Host Kartengröße, Flussdichte, Seed, Nachschub, KI-Stufe, Siegbedingung und Karten fest; diese Einstellungen werden im Raum angezeigt.
- Online-KI-Züge werden autoritativ auf dem Server ausgeführt und jeder einzelne Kampf wird nacheinander animiert.
- Die integrierte Spielhilfe erklärt Einheitenklassen, Gelände, Bonus-/Malusregeln, Haltungen, Karten, Skills und Online-Partien.

---

- One human plays against 1–5 AI factions across 36, 60, or 90 regions.
- AI commanders receive unique, humorous parody names determined by the seed.
- A color-coded ranking orders every faction by controlled territories and shows its total troop strength.
- Every unit rolls one D6. The higher total wins; ties favor the defender.
- Infantry defends forests and cities, armor attacks plains more effectively, and artillery supports attacks.
- Pioneers, supply troops, and snipers add specialist play: they cross swamps/rivers, boost one reinforcement phase, or cancel coastal penalties and reveal exact odds.
- Each match offers none, few, normal, or many rivers; rivers are routed randomly through the interior and end at an automatically detected coast. Swamps hinder attacks while giving infantry cover.
- Before an attack, automatic selection chooses the stance with the best win chance for the clicked target. A manual stance gives its matching class +1 per die but every other class −1; a successful, strictly riskier manual choice can loot a tactical card when there is room in hand. A territory holds at most three unit types.
- Reinforcements depend on the largest connected territory group and controlled cities.
- Headquarters and controlled cities form a supply network. Cut-off regions receive reinforcements only as a fallback and defend with one fewer die; attack strength is unchanged.
- Optional tactical cards provide supply, redeployment, combat support, fortifications, lucky rerolls, mobilization, and later-unlocked supply tactics; one card is drawn at the start of each turn.
- Persistent achievements are stored in a browser-bound profile. They unlock new cards and skills; players choose up to two skills before a match (three after a progression unlock).
- Choose total conquest or headquarters elimination.
- Every faction starts with a compact home cluster; starting armies cannot reach an enemy headquarters during round one.
- Every territory contains at least four connected hex cells.
- The most recently used match settings are preselected on the next visit.
- An untouched opening map can be rejected and rerolled immediately with the same match settings.
- Matches are autosaved in the browser. The same seed creates the same map.
- Online rooms use a private six-character code, nicknames, and reconnect tokens. After 60 seconds a turn is skipped once; on the second timeout the AI takes over.
- When creating an online room, the host chooses map size, river density, seed, supply, AI level, victory condition, and cards; these settings are shown in the room.
- Online AI turns run authoritatively on the server, and every individual battle is animated in sequence.
- The integrated help page explains unit classes, terrain, bonus and penalty rules, stances, cards, skills, and online matches.

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
