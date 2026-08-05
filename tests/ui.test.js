import test from "node:test";
import assert from "node:assert/strict";
import { calculateReinforcements, createGame, TERRAIN_TYPES } from "../src/core/game.js";
import { GameApp } from "../src/ui.js";

test("the map renders one compact vector badge per region", (context) => {
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
  app.resetCamera();

  const svg = app.renderMap();
  for (const terrain of TERRAIN_TYPES) {
    assert.match(svg, new RegExp(`class="region terrain-${terrain}`));
  }
  const badgeCount = [...svg.matchAll(/class="terrain-badge"/g)].length;
  assert.equal(badgeCount, app.state.map.regions.length);
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
  assert.match(map, /combat-source/);
  assert.match(map, /combat-target/);

  app.turnNotification = { playerId: app.state.players[0].id, round: 1 };
  assert.match(app.renderTurnNotification(), /Du bist am Zug/);
});
