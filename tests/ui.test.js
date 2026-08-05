import test from "node:test";
import assert from "node:assert/strict";
import { createGame, TERRAIN_TYPES } from "../src/core/game.js";
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
