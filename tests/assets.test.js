import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const assets = ["infantry", "armor", "artillery"];

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
