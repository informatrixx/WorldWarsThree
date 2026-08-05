import test from "node:test";
import assert from "node:assert/strict";
import { calculateReinforcements, createGame, getLegalTargets, TERRAIN_TYPES } from "../src/core/game.js";
import { GameApp } from "../src/ui.js";

test("the map renders terrain badges and one overlapping sprite per unit", (context) => {
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
  const badgeCount = [...svg.matchAll(/class="terrain-badge"/g)].length;
  assert.equal(badgeCount, app.state.map.regions.length);
  const allUnits = app.state.map.regions.flatMap((region) => region.units);
  assert.equal([...svg.matchAll(/class="map-unit-sprite unit-/g)].length, allUnits.length);
  for (const type of ["infantry", "armor", "artillery"]) {
    assert.equal(
      [...svg.matchAll(new RegExp(`href="assets/units/${type}\\.png"`, "g"))].length,
      allUnits.filter((unit) => unit === type).length,
    );
  }
  assert.match(svg, /data-stack-row="1"/);
  assert.doesNotMatch(svg, /unit-mix/);
  assert.doesNotMatch(svg, /class="terrain-detail"/);
  assert.doesNotMatch(svg, /class="terrain-symbol"/);
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
  assert.match(map, /class="hq-emblem"/);
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
