import test from "node:test";
import assert from "node:assert/strict";
import { calculateReinforcements, createGame, getActivePlayer, getLegalTargets, TERRAIN_TYPES } from "../src/core/game.js";
import { GameApp } from "../src/ui.js";

test("setup preferences persist and preselect the next match form", (context) => {
  const storage = new Map([["dicefront-dominion:setup:v1", JSON.stringify({
    playerCount: 6,
    mapSize: "large",
    supplyRate: "high",
    difficulty: "hard",
    victoryMode: "conquest",
    cardsEnabled: false,
    seed: "saved-seed",
  })]]);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = { addEventListener() {} };
  context.after(() => {
    delete globalThis.localStorage;
    delete globalThis.window;
  });
  const root = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: (selector) => (selector === "#continue-game" ? null : { addEventListener() {} }),
  };
  const app = new GameApp(root);
  app.renderSetup();

  assert.match(root.innerHTML, /option value="6" selected/);
  assert.match(root.innerHTML, /option value="large" selected/);
  assert.match(root.innerHTML, /option value="high" selected/);
  assert.match(root.innerHTML, /option value="hard" selected/);
  assert.match(root.innerHTML, /option value="conquest" selected/);
  assert.match(root.innerHTML, /id="seed-input"[^>]*value="saved-seed"/);
  assert.doesNotMatch(root.innerHTML, /name="cardsEnabled" checked/);

  app.saveSetupPreferences({ ...app.setupPreferences, playerCount: 3, seed: "" });
  const saved = JSON.parse(storage.get("dicefront-dominion:setup:v1"));
  assert.equal(saved.playerCount, 3);
  assert.equal(saved.seed, "");

  storage.set("dicefront-dominion:setup:v1", JSON.stringify({ playerCount: 99, mapSize: "invalid" }));
  const fallback = new GameApp(root).setupPreferences;
  assert.equal(fallback.playerCount, 4);
  assert.equal(fallback.mapSize, "medium");
  assert.equal(fallback.cardsEnabled, true);
});

test("continuing a saved human turn clears transient locks and restores legal attacks", (context) => {
  globalThis.window = {
    addEventListener() {},
    clearTimeout() {},
  };
  context.after(() => delete globalThis.window);
  const app = new GameApp({});
  app.savedState = createGame({
    playerCount: 2,
    mapSize: "small",
    difficulty: "normal",
    victoryMode: "headquarters",
    cardsEnabled: false,
    locale: "de",
    seed: "continued-human-turn-test",
  });
  app.aiRunning = true;
  app.aiTimer = 12;
  app.combatAnimation = { battle: {} };
  app.combatAnimationTimer = 13;
  app.turnNotification = { playerId: 1, round: 1 };
  app.turnNotificationTimer = 14;
  app.selectedSource = 2;
  app.selectedTarget = 3;
  let announced = 0;
  app.audio.setMatchActive = () => {};
  app.announceCurrentTurn = () => { announced += 1; };

  app.continueSavedGame();

  assert.equal(announced, 1);
  assert.equal(getActivePlayer(app.state).isHuman, true);
  assert.equal(app.aiRunning, false);
  assert.equal(app.combatAnimation, null);
  assert.equal(app.selectedSource, null);
  assert.equal(app.selectedTarget, null);
  assert.ok(app.state.map.regions.some((region) => (
    region.ownerId === 0 && region.units.length >= 2 && getLegalTargets(app.state, region.id).length > 0
  )));
});

test("continuing during an AI turn immediately restarts AI processing", (context) => {
  let scheduled = 0;
  globalThis.window = {
    addEventListener() {},
    clearTimeout() {},
    setTimeout() { scheduled += 1; return scheduled; },
  };
  context.after(() => delete globalThis.window);
  const node = { addEventListener() {} };
  const root = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => node,
  };
  const app = new GameApp(root);
  app.savedState = createGame({
    playerCount: 2,
    mapSize: "small",
    difficulty: "normal",
    victoryMode: "headquarters",
    cardsEnabled: false,
    locale: "de",
    seed: "continued-ai-turn-test",
  });
  app.savedState.turn.activePlayerIndex = 1;
  app.audio.setMatchActive = () => {};

  app.continueSavedGame();

  assert.equal(getActivePlayer(app.state).isHuman, false);
  assert.equal(app.aiRunning, true);
  assert.equal(app.aiTimer, 1);
  assert.equal(scheduled, 1);
});

test("an untouched opening map can be rejected and immediately reseeded", (context) => {
  globalThis.window = {
    addEventListener() {},
    clearTimeout() {},
  };
  context.after(() => delete globalThis.window);
  const node = { addEventListener() {} };
  const root = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => node,
  };
  const app = new GameApp(root);
  app.state = createGame({
    playerCount: 3,
    mapSize: "small",
    difficulty: "hard",
    victoryMode: "conquest",
    supplyRate: "high",
    cardsEnabled: true,
    locale: "de",
    seed: "rejected-opening-map",
  });
  app.audio.setMatchActive = () => {};
  app.audio.playTurnStart = async () => true;
  app.audio.playCardDraw = async () => true;
  let announced = 0;
  app.announceCurrentTurn = () => { announced += 1; };
  app.selectedSource = 4;
  const previousSeed = app.state.config.seed;

  assert.equal(app.canReseedMap(), true);
  app.renderGame();
  assert.match(root.innerHTML, /id="reseed-map"/);
  app.reseedMap();

  assert.notEqual(app.state.config.seed, previousSeed);
  assert.equal(app.state.config.playerCount, 3);
  assert.equal(app.state.config.mapSize, "small");
  assert.equal(app.state.config.difficulty, "hard");
  assert.equal(app.state.config.victoryMode, "conquest");
  assert.equal(app.state.config.supplyRate, "high");
  assert.equal(app.state.config.cardsEnabled, true);
  assert.equal(app.selectedSource, null);
  assert.equal(announced, 1);
  assert.equal(app.canReseedMap(), true);

  app.state.log.unshift({ type: "battle" });
  assert.equal(app.canReseedMap(), false);
  app.renderGame();
  assert.doesNotMatch(root.innerHTML, /id="reseed-map"/);
});

test("the map integrates each unit type and territory information into owned hex cells", (context) => {
  globalThis.window = { addEventListener() {} };
  context.after(() => delete globalThis.window);
  const app = new GameApp({});
  app.state = createGame({
    playerCount: 4,
    mapSize: "medium",
    difficulty: "normal",
    victoryMode: "headquarters",
    locale: "de",
    seed: "terrain-detail-test",
  });
  app.state.map.regions[0].units = [
    "infantry", "infantry", "infantry", "armor", "armor", "artillery", "artillery", "artillery",
  ];
  app.resetCamera();

  const svg = app.renderMap();
  for (const terrain of TERRAIN_TYPES) {
    assert.match(svg, new RegExp(`class="region terrain-${terrain}`));
  }
  assert.equal([...svg.matchAll(/class="territory-formation"/g)].length, app.state.map.regions.length);
  assert.doesNotMatch(svg, /territory-token|territory-token-bg/);
  assert.match(svg, /class="map-regions"[\s\S]*class="map-markers"/);
  assert.equal([...svg.matchAll(/class="region-marker-owner /g)].length, app.state.map.regions.length);
  assert.equal([...svg.matchAll(/class="token-terrain"/g)].length, app.state.map.regions.length);
  const expectedTypeMarkers = app.state.map.regions.reduce((sum, region) => (
    sum + new Set(region.units).size
  ), 0);
  assert.equal([...svg.matchAll(/class="force-type force-/g)].length, expectedTypeMarkers);
  assert.match(svg, /class="map-detail-overview"/);
  assert.doesNotMatch(svg, /map-unit-sprite|unit-glyph-/);
  for (const type of ["infantry", "armor", "artillery"]) {
    const expected = app.state.map.regions.filter((region) => region.units.includes(type)).length;
    assert.equal(
      [...svg.matchAll(new RegExp(`class="force-image" href="assets/units/${type}\\.png"`, "g"))].length,
      expected,
    );
  }

  const firstRegion = svg.slice(svg.indexOf('data-marker-region-id="0"'), svg.indexOf('data-marker-region-id="1"'));
  assert.match(firstRegion, /class="unit-total"[^>]*>8<\/text>/);
  assert.match(firstRegion, /force-infantry[\s\S]*class="force-count"[^>]*>3<\/text>/);
  assert.match(firstRegion, /force-armor[\s\S]*class="force-count"[^>]*>2<\/text>/);
  assert.match(firstRegion, /force-artillery[\s\S]*class="force-count"[^>]*>3<\/text>/);
  assert.equal([...firstRegion.matchAll(/class="force-count-bg"/g)].length, 3);
  assert.match(firstRegion, /class="unit-total-bg"/);
  const occupiedCells = [...firstRegion.matchAll(/data-cell-q="(-?\d+)" data-cell-r="(-?\d+)"/g)]
    .map((match) => `${match[1]},${match[2]}`);
  assert.equal(new Set(occupiedCells).size, 4);
  const regionCells = new Set(app.state.map.regions[0].cells.map((cell) => `${cell.q},${cell.r}`));
  assert.ok(occupiedCells.every((key) => regionCells.has(key)));

  app.camera.width = app.state.map.bounds.width * 0.7;
  assert.equal(app.mapDetailClass(), "map-detail-tactical");
});

test("player overview, turn notice, and combat territories expose tactical context", (context) => {
  globalThis.window = { addEventListener() {} };
  context.after(() => delete globalThis.window);
  const app = new GameApp({});
  app.state = createGame({
    playerCount: 4,
    mapSize: "medium",
    difficulty: "normal",
    victoryMode: "headquarters",
    locale: "de",
    seed: "tactical-context-test",
  });
  app.resetCamera();

  const players = app.renderPlayers();
  for (const player of app.state.players) {
    const reinforcements = calculateReinforcements(app.state, player.id);
    assert.match(players, new RegExp(`<b>\\+${reinforcements}</b>`));
    if (!player.isHuman) assert.match(players, new RegExp(player.commanderName));
  }
  assert.doesNotMatch(players, /KI-Kommandant/);

  const transferred = app.state.map.regions.find((region) => region.ownerId === 1 && !region.isHeadquarters);
  transferred.ownerId = 0;
  const ranking = app.renderRanking();
  const expectedOrder = app.state.players.map((player) => ({
    player,
    territories: app.state.map.regions.filter((region) => region.ownerId === player.id).length,
    units: app.state.map.regions
      .filter((region) => region.ownerId === player.id)
      .reduce((sum, region) => sum + region.units.length, 0),
  })).sort((first, second) => second.territories - first.territories || first.player.id - second.player.id);
  assert.equal([...ranking.matchAll(/class="ranking-entry /g)].length, app.state.players.length);
  expectedOrder.forEach(({ player, territories, units }, index) => {
    const name = player.isHuman ? "Du" : player.commanderName;
    const previous = index ? expectedOrder[index - 1].player : null;
    const previousName = previous ? (previous.isHuman ? "Du" : previous.commanderName) : null;
    assert.ok(ranking.indexOf(name) > (previousName ? ranking.indexOf(previousName) : -1));
    assert.match(ranking, new RegExp(`--rank-color:${player.style.color}`));
    assert.match(ranking, new RegExp(`class="ranking-territories">${territories}<small>`));
    assert.match(ranking, new RegExp(`class="ranking-units">${units}<small>`));
  });
  assert.equal([...ranking.matchAll(/class="ranking-position">2<\/b>/g)].length, 2);

  const source = app.state.map.regions.find((region) => region.units.length >= 2);
  const targetId = source.neighbors[0];
  app.combatAnimation = { battle: { sourceId: source.id, targetId } };
  const map = app.renderMap();
  assert.match(map, /class="region terrain-[^"]+ headquarters/);
  assert.match(map, /class="hq-token"/);
  assert.match(map, /combat-source/);
  assert.match(map, /combat-target/);

  app.turnNotification = { playerId: app.state.players[0].id, round: 1 };
  assert.match(app.renderTurnNotification(), /Du bist am Zug/);
});

test("legal neighboring targets show relative modifiers while a prior battle animates", (context) => {
  globalThis.window = { addEventListener() {} };
  context.after(() => delete globalThis.window);
  const app = new GameApp({});
  app.state = createGame({
    playerCount: 2,
    mapSize: "small",
    difficulty: "normal",
    victoryMode: "headquarters",
    locale: "de",
    seed: "modifier-target-test",
  });
  app.resetCamera();
  const source = app.state.map.regions.find((region) => (
    region.ownerId === 0 && region.units.length >= 2 && getLegalTargets(app.state, region.id).length
  ));
  const targets = getLegalTargets(app.state, source.id);
  const negativeTarget = app.state.map.regions[targets[0]];
  source.units = ["infantry", "infantry"];
  negativeTarget.units = ["infantry", "infantry", "infantry"];
  negativeTarget.terrain = "forest";
  app.selectedSource = source.id;
  app.combatAnimation = { battle: { sourceId: source.id, targetId: negativeTarget.id } };

  const map = app.renderMap();
  assert.equal([...map.matchAll(/class="combat-modifier modifier-/g)].length, targets.length);
  assert.match(map, /combat-modifier modifier-negative/);
  assert.match(map, />−3<\/text>/);
  assert.match(map, /relativer Kampfbonus −3/);
  assert.match(map, /selected-source/);
  assert.match(map, /legal-target/);
  assert.doesNotMatch(map, /combat-source|combat-target/);
});

test("capture color is immediate for the human and delayed during AI combat animation", (context) => {
  globalThis.window = { addEventListener() {} };
  context.after(() => delete globalThis.window);
  const app = new GameApp({});
  app.state = createGame({
    playerCount: 2,
    mapSize: "small",
    difficulty: "normal",
    victoryMode: "headquarters",
    locale: "de",
    seed: "delayed-capture-color-test",
  });
  app.resetCamera();
  const target = app.state.map.regions.find((region) => region.ownerId === 0 && !region.isHeadquarters);
  const attacker = app.state.players[1];
  const defender = app.state.players[0];
  const source = app.state.map.regions.find((region) => region.ownerId === attacker.id);
  const attackingUnits = ["armor", "armor", "artillery"];
  const defendingUnits = ["infantry", "infantry", "artillery"];
  source.units = ["infantry"];
  target.ownerId = attacker.id;
  target.units = ["armor"];
  app.combatAnimation = {
    battle: {
      attackerWon: true,
      attackerId: attacker.id,
      defenderId: defender.id,
      sourceId: source.id,
      targetId: target.id,
      attackerDice: attackingUnits.map((type) => ({ type })),
      defenderDice: defendingUnits.map((type) => ({ type })),
    },
  };

  const duringAnimation = app.renderMap();
  assert.match(duringAnimation, /class="ai-attack-arrow"/);
  assert.doesNotMatch(duringAnimation, /ai-arrowhead|marker-end=/);
  const animatedTarget = duringAnimation.slice(
    duringAnimation.indexOf(`data-region-id="${target.id}"`),
    duringAnimation.indexOf("</g>", duringAnimation.indexOf(`data-region-id="${target.id}"`)),
  );
  const animatedMarker = duringAnimation.slice(
    duringAnimation.indexOf(`data-marker-region-id="${target.id}"`),
    duringAnimation.indexOf("</g>\n          </g>", duringAnimation.indexOf(`data-marker-region-id="${target.id}"`)),
  );
  assert.match(animatedTarget, new RegExp(`--region-color:${defender.style.color}`));
  assert.match(animatedTarget, new RegExp(`player-pattern-${defender.id}`));
  assert.match(animatedMarker, /class="unit-total"[^>]*>3<\/text>/);
  assert.match(animatedMarker, /force-infantry[\s\S]*class="force-count"[^>]*>2<\/text>/);
  assert.match(animatedMarker, /force-artillery[\s\S]*class="force-count"[^>]*>1<\/text>/);
  assert.doesNotMatch(animatedMarker, /force-armor/);
  const animatedSourceMarker = duringAnimation.slice(
    duringAnimation.indexOf(`data-marker-region-id="${source.id}"`),
    duringAnimation.indexOf("</g>\n          </g>", duringAnimation.indexOf(`data-marker-region-id="${source.id}"`)),
  );
  assert.match(animatedSourceMarker, /class="unit-total"[^>]*>3<\/text>/);
  assert.match(animatedSourceMarker, /force-armor[\s\S]*class="force-count"[^>]*>2<\/text>/);
  assert.match(animatedSourceMarker, /force-artillery[\s\S]*class="force-count"[^>]*>1<\/text>/);
  assert.doesNotMatch(animatedSourceMarker, /force-infantry/);

  app.combatAnimation = null;
  const afterAnimation = app.renderMap();
  const revealedTarget = afterAnimation.slice(
    afterAnimation.indexOf(`data-region-id="${target.id}"`),
    afterAnimation.indexOf("</g>", afterAnimation.indexOf(`data-region-id="${target.id}"`)),
  );
  const revealedMarker = afterAnimation.slice(
    afterAnimation.indexOf(`data-marker-region-id="${target.id}"`),
    afterAnimation.indexOf("</g>\n          </g>", afterAnimation.indexOf(`data-marker-region-id="${target.id}"`)),
  );
  assert.match(revealedTarget, new RegExp(`--region-color:${attacker.style.color}`));
  assert.match(revealedTarget, new RegExp(`player-pattern-${attacker.id}`));
  assert.match(revealedMarker, /class="unit-total"[^>]*>1<\/text>/);
  assert.match(revealedMarker, /force-armor[\s\S]*class="force-count"[^>]*>1<\/text>/);
  const revealedSourceMarker = afterAnimation.slice(
    afterAnimation.indexOf(`data-marker-region-id="${source.id}"`),
    afterAnimation.indexOf("</g>\n          </g>", afterAnimation.indexOf(`data-marker-region-id="${source.id}"`)),
  );
  assert.match(revealedSourceMarker, /class="unit-total"[^>]*>1<\/text>/);
  assert.match(revealedSourceMarker, /force-infantry[\s\S]*class="force-count"[^>]*>1<\/text>/);

  target.ownerId = defender.id;
  app.combatAnimation = {
    battle: {
      attackerWon: true,
      attackerId: defender.id,
      defenderId: attacker.id,
      sourceId: app.state.map.regions.find((region) => region.ownerId === defender.id).id,
      targetId: target.id,
    },
  };
  const humanCapture = app.renderMap();
  assert.doesNotMatch(humanCapture, /class="ai-attack-arrow"/);
  const humanTarget = humanCapture.slice(
    humanCapture.indexOf(`data-region-id="${target.id}"`),
    humanCapture.indexOf("</g>", humanCapture.indexOf(`data-region-id="${target.id}"`)),
  );
  assert.match(humanTarget, new RegExp(`--region-color:${defender.style.color}`));
  assert.match(humanTarget, new RegExp(`player-pattern-${defender.id}`));
});

test("the tactical card panel keeps AI cards secret and highlights legal card targets", (context) => {
  globalThis.window = { addEventListener() {} };
  context.after(() => delete globalThis.window);
  const app = new GameApp({});
  app.state = createGame({
    playerCount: 2,
    mapSize: "small",
    difficulty: "normal",
    victoryMode: "headquarters",
    cardsEnabled: true,
    locale: "de",
    seed: "card-ui-test",
  });
  const original = app.state.players[0].hand.pop();
  app.state.cards.drawPile.push(original);
  const fortificationIndex = app.state.cards.drawPile.findIndex((card) => card.type === "fortification");
  const [fortification] = app.state.cards.drawPile.splice(fortificationIndex, 1);
  app.state.players[0].hand.push(fortification);
  const luckyIndex = app.state.cards.drawPile.findIndex((card) => card.type === "luckyRoll");
  const [lucky] = app.state.cards.drawPile.splice(luckyIndex, 1);
  app.state.players[1].hand.push(lucky);
  app.resetCamera();

  const panel = app.renderCardsPanel();
  assert.match(panel, /Befestigung/);
  assert.doesNotMatch(panel, /Würfelglück/);
  assert.match(app.renderPlayers(), /Karten/);

  app.selectedCardId = fortification.id;
  const targetCount = app.state.map.regions.filter((region) => region.ownerId === 0).length;
  const map = app.renderMap();
  assert.equal([...map.matchAll(/class="region terrain-[^"]*card-target/g)].length, targetCount);
  assert.equal([...map.matchAll(/class="region-marker-owner terrain-[^"]*card-target/g)].length, targetCount);

  const regionId = app.state.map.regions.find((region) => region.ownerId === 0).id;
  app.state.cards.effects.push({ type: "fortification", playerId: 0, regionId, cardId: fortification.id });
  assert.match(app.renderMap(), /effect-fortification/);
});
