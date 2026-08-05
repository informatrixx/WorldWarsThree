import test from "node:test";
import assert from "node:assert/strict";
import { createGame, TERRAIN_TYPES } from "../src/core/game.js";
import { GameApp } from "../src/ui.js";

test("the map renders a vector detail layer for every terrain type", (context) => {
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
    assert.match(svg, new RegExp(`id="terrain-${terrain}"`));
    assert.match(svg, new RegExp(`class="region terrain-${terrain}`));
    assert.match(svg, new RegExp(`--terrain:url\\(#terrain-${terrain}\\)`));
  }
  assert.match(svg, /class="terrain-detail"/);
  assert.doesNotMatch(svg, /class="terrain-symbol"/);
});
