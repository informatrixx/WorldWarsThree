import test from "node:test";
import assert from "node:assert/strict";
import { calculateReinforcements, createGame, getLegalTargets, TERRAIN_TYPES } from "../src/core/game.js";
import { GameApp } from "../src/ui.js";

test("the map renders one compact strength marker with exact composition per territory", (context) => {
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
  assert.equal([...svg.matchAll(/class="territory-token"/g)].length, app.state.map.regions.length);
  assert.equal([...svg.matchAll(/class="token-terrain"/g)].length, app.state.map.regions.length);
  const expectedTypeMarkers = app.state.map.regions.reduce((sum, region) => (
    sum + new Set(region.units).size
  ), 0);
  assert.equal([...svg.matchAll(/class="force-type force-/g)].length, expectedTypeMarkers);
  assert.match(svg, /class="map-detail-overview"/);
  assert.doesNotMatch(svg, /map-unit-sprite|assets\/units\//);

  const firstRegion = svg.slice(svg.indexOf('data-region-id="0"'), svg.indexOf('data-region-id="1"'));
  assert.match(firstRegion, /class="unit-total"[^>]*>8<\/text>/);
  assert.match(firstRegion, /force-infantry[\s\S]*class="force-count"[^>]*>3<\/text>/);
  assert.match(firstRegion, /force-armor[\s\S]*class="force-count"[^>]*>2<\/text>/);
  assert.match(firstRegion, /force-artillery[\s\S]*class="force-count"[^>]*>3<\/text>/);

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
  }

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
  assert.equal([...map.matchAll(/card-target/g)].length, targetCount);

  const regionId = app.state.map.regions.find((region) => region.ownerId === 0).id;
  app.state.cards.effects.push({ type: "fortification", playerId: 0, regionId, cardId: fortification.id });
  assert.match(app.renderMap(), /effect-fortification/);
});
