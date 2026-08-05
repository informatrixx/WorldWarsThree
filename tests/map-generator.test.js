import test from "node:test";
import assert from "node:assert/strict";

import {
  articulationPoints,
  generateMap,
  MAP_SIZES,
  MIN_REGION_CELLS,
  regionGraphIsConnected,
} from "../src/core/map-generator.js";

const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

function regionCellsAreConnected(region) {
  const keys = new Set(region.cells.map((cell) => `${cell.q},${cell.r}`));
  const first = region.cells[0];
  const visited = new Set([`${first.q},${first.r}`]);
  const queue = [first];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cell = queue[cursor];
    for (const [dq, dr] of DIRECTIONS) {
      const key = `${cell.q + dq},${cell.r + dr}`;
      if (keys.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push({ q: cell.q + dq, r: cell.r + dr });
      }
    }
  }
  return visited.size === region.cells.length;
}

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
      assert.ok(map.regions.every((region) => region.cells.length >= MIN_REGION_CELLS));
      for (const region of map.regions) {
        assert.equal(regionCellsAreConnected(region), true);
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
