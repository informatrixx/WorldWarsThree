import test from "node:test";
import assert from "node:assert/strict";

import { loadProfile, normalizeProfile, saveProfile, unlockProfile } from "../src/profile.js";

test("profile validation keeps only known unlocks and clamps skill slots", () => {
  const profile = normalizeProfile({
    unlockedCards: ["supplyConvoy", "unknown", "supplyConvoy"],
    unlockedSkills: ["recon", "unknown"],
    skillSlots: 9,
    stats: { wins: -2, attacksWon: "4" },
  }, ["supplyConvoy"], ["recon"]);
  assert.deepEqual(profile.unlockedCards, ["supplyConvoy"]);
  assert.deepEqual(profile.unlockedSkills, ["recon"]);
  assert.equal(profile.skillSlots, 2);
  assert.equal(profile.stats.wins, 0);
  assert.equal(profile.stats.attacksWon, 4);
});

test("profile unlocks persist through the browser storage adapter", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const base = loadProfile(["supplyConvoy"], ["recon"]);
  const unlocked = unlockProfile(base, { card: "supplyConvoy", skill: "recon", thirdSlot: true }, ["supplyConvoy"], ["recon"]);
  saveProfile(unlocked, ["supplyConvoy"], ["recon"]);
  const loaded = loadProfile(["supplyConvoy"], ["recon"]);
  assert.deepEqual(loaded.unlockedCards, ["supplyConvoy"]);
  assert.deepEqual(loaded.unlockedSkills, ["recon"]);
  assert.equal(loaded.skillSlots, 3);
  delete globalThis.localStorage;
});

