import test from "node:test";
import assert from "node:assert/strict";

import {
  articulationPoints,
  generateMap,
  MAP_SIZES,
  regionGraphIsConnected,
} from "../src/core/map-generator.js";

test("the same seed creates the same map", () => {
  const first = generateMap({ size: "medium", seed: "repeatable" });
  const second = generateMap({ size: "medium", seed: "repeatable" });
  assert.deepEqual(first, second);
});
test("all supported sizes create a connected, symmetric region graph", () => {
  for (const [size, expected] of Object.entries(MAP_SIZES)) {
    for (let index = 0; index < 8; index += 1) {
      const map = generateMap({ size, seed: `${size}-${index}` });
      assert.equal(map.regions.length, expected);
      assert.equal(regionGraphIsConnected(map.regions), true);
      assert.ok(map.regions.every((region) => region.cells.length > 0));
      for (const region of map.regions) {
        assert.ok(region.neighbors.length > 0);
        for (const neighbor of region.neighbors) {
          assert.ok(map.regions[neighbor].neighbors.includes(region.id));
        }
      }
    }
  }
});

test("seed profiles include both open maps and maps with strategic bottlenecks", () => {
  const samples = Array.from({ length: 40 }, (_, index) => generateMap({
    size: "medium",
    seed: `profile-${index}`,
  }));
  assert.ok(samples.some((map) => map.profile === "open"));
  assert.ok(samples.some((map) => map.profile === "mixed"));
  assert.ok(samples.some((map) => map.profile === "fractured"));
  assert.ok(samples.some((map) => articulationPoints(map.regions).length >= 3));
  for (const map of samples) {
    const aspectRatio = Math.max(
      map.bounds.width / map.bounds.height,
      map.bounds.height / map.bounds.width,
    );
    assert.ok(aspectRatio <= 2.25, `map ${map.seed} is too elongated (${aspectRatio})`);
  }
});
