import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const assets = ["infantry", "armor", "artillery", "pioneers", "supply", "snipers"];
const terrainAssets = [
  "plains", "forest", "hills", "city", "swamp",
  "plains-detail", "forest-detail", "hills-detail", "city-detail", "swamp-detail",
  "plains-detail-alt", "forest-detail-alt", "hills-detail-alt", "city-detail-alt", "swamp-detail-alt",
  "plains-detail-extra", "forest-detail-extra", "hills-detail-extra", "city-detail-extra", "swamp-detail-extra",
  "plains-detail-alt2", "forest-detail-alt2", "hills-detail-alt2", "city-detail-alt2", "swamp-detail-alt2",
  "plains-detail-alt3", "forest-detail-alt3", "hills-detail-alt3", "city-detail-alt3", "swamp-detail-alt3",
];

test("unit sprites are optimized transparent PNG files", async () => {
  for (const asset of assets) {
    const path = new URL(`../assets/units/${asset}.png`, import.meta.url);
    const data = await readFile(path);
    const metadata = await stat(path);
    assert.deepEqual([...data.subarray(1, 4)], [80, 78, 71], `${asset} is not a PNG`);
    assert.equal(data.readUInt32BE(16), 256, `${asset} width`);
    assert.equal(data.readUInt32BE(20), 256, `${asset} height`);
    assert.equal(data[25], 6, `${asset} must use RGBA color`);
    assert.ok(metadata.size < 100_000, `${asset} is too large`);
  }
});

test("terrain sprites are optimized transparent PNG files", async () => {
  for (const asset of terrainAssets) {
    const path = new URL(`../assets/terrain/${asset}.png`, import.meta.url);
    const data = await readFile(path);
    const metadata = await stat(path);
    assert.deepEqual([...data.subarray(1, 4)], [80, 78, 71], `${asset} is not a PNG`);
    assert.equal(data.readUInt32BE(16), 256, `${asset} width`);
    assert.equal(data.readUInt32BE(20), 256, `${asset} height`);
    assert.equal(data[25], 6, `${asset} must use RGBA color`);
    assert.ok(metadata.size < 100_000, `${asset} is too large`);
  }
});
