import test from "node:test";
import assert from "node:assert/strict";

import { chooseAiAttack, playAiTurn } from "../src/core/ai.js";
import {
  calculateReinforcements,
  computeBattleOdds,
  createGame,
  deserializeGame,
  endTurn,
  getLegalAttacks,
  resolveAttack,
  serializeGame,
  UNIT_CAP,
  validateGameState,
} from "../src/core/game.js";

function gameConfig(overrides = {}) {
  return {
    playerCount: 4,
    mapSize: "small",
    difficulty: "normal",
    victoryMode: "headquarters",
    locale: "de",
    seed: "test-seed",
    ...overrides,
  };
}

function firstLegalAttack(state) {
  const attack = getLegalAttacks(state)[0];
  assert.ok(attack, "expected at least one legal attack");
  return attack;
}

test("starting ownership, unit totals, and class composition are balanced", () => {
  for (let playerCount = 2; playerCount <= 6; playerCount += 1) {
    const state = createGame(gameConfig({ playerCount, seed: `balance-${playerCount}` }));
    const regions = state.players.map((player) => state.map.regions.filter((region) => region.ownerId === player.id));
    const regionCounts = regions.map((owned) => owned.length);
    assert.ok(Math.max(...regionCounts) - Math.min(...regionCounts) <= 1);
    const unitTotals = regions.map((owned) => owned.reduce((sum, region) => sum + region.units.length, 0));
    assert.equal(new Set(unitTotals).size, 1);
    const classTotals = regions.map((owned) => owned.flatMap((region) => region.units).sort().join(","));
    assert.equal(new Set(classTotals).size, 1);
    assert.equal(state.map.regions.filter((region) => region.isHeadquarters).length, playerCount);
    assert.ok(state.map.regions.every((region) => region.units.length >= 1 && region.units.length <= UNIT_CAP));
  }
});

test("a winning attack captures the target and moves all but one unit", () => {
  const state = createGame(gameConfig());
  const { sourceId, targetId } = firstLegalAttack(state);
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  const attackerId = source.ownerId;
  const attackingUnits = source.units.length;
  target.isHeadquarters = false;
  const result = resolveAttack(state, sourceId, targetId, {
    attackerRolls: Array(attackingUnits).fill(6),
    defenderRolls: Array(target.units.length).fill(1),
  });
  assert.equal(result.battle.attackerWon, true);
  assert.equal(result.state.map.regions[sourceId].units.length, 1);
  assert.equal(result.state.map.regions[targetId].units.length, attackingUnits - 1);
  assert.equal(result.state.map.regions[targetId].ownerId, attackerId);
});

test("a lost attack leaves one attacker and does not damage defenders", () => {
  const state = createGame(gameConfig());
  const { sourceId, targetId } = firstLegalAttack(state);
  const target = state.map.regions[targetId];
  target.isHeadquarters = false;
  const defenderId = target.ownerId;
  const defenderUnits = [...target.units];
  const result = resolveAttack(state, sourceId, targetId, {
    attackerRolls: Array(state.map.regions[sourceId].units.length).fill(1),
    defenderRolls: Array(target.units.length).fill(6),
  });
  assert.equal(result.battle.attackerWon, false);
  assert.equal(result.state.map.regions[sourceId].units.length, 1);
  assert.deepEqual(result.state.map.regions[targetId].units, defenderUnits);
  assert.equal(result.state.map.regions[targetId].ownerId, defenderId);
});

test("ties favor the defender and terrain/class modifiers affect the odds", () => {
  const state = createGame(gameConfig({ playerCount: 2 }));
  const { sourceId, targetId } = firstLegalAttack(state);
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  source.units = ["infantry", "infantry"];
  target.units = ["infantry", "infantry"];
  target.terrain = "forest";
  const forestOdds = computeBattleOdds(state, sourceId, targetId);
  target.terrain = "plains";
  const plainsOdds = computeBattleOdds(state, sourceId, targetId);
  assert.ok(forestOdds < plainsOdds);
  const tied = resolveAttack(state, sourceId, targetId, {
    attackerRolls: [3, 3],
    defenderRolls: [3, 3],
  });
  assert.equal(tied.battle.attackerWon, false);
});

test("capturing a headquarters eliminates the faction and transfers its territory", () => {
  const state = createGame(gameConfig({ playerCount: 2 }));
  const { sourceId, targetId } = firstLegalAttack(state);
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  const attackerId = source.ownerId;
  const defenderId = target.ownerId;
  state.map.regions.forEach((region) => { region.isHeadquarters = false; });
  target.isHeadquarters = true;
  state.players[defenderId].headquartersRegionId = targetId;
  const result = resolveAttack(state, sourceId, targetId, {
    attackerRolls: Array(source.units.length).fill(6),
    defenderRolls: Array(target.units.length).fill(1),
  });
  assert.equal(result.state.players[defenderId].active, false);
  assert.ok(result.state.map.regions.every((region) => region.ownerId !== defenderId));
  assert.equal(result.state.phase, "finished");
  assert.equal(result.state.winnerId, attackerId);
});

test("end turn places reinforcements within the unit cap and advances play", () => {
  const state = createGame(gameConfig());
  const playerId = state.players[state.turn.activePlayerIndex].id;
  const before = state.map.regions
    .filter((region) => region.ownerId === playerId)
    .reduce((sum, region) => sum + region.units.length, 0);
  const expected = calculateReinforcements(state, playerId);
  const next = endTurn(state);
  const after = next.map.regions
    .filter((region) => region.ownerId === playerId)
    .reduce((sum, region) => sum + region.units.length, 0);
  assert.equal(after - before, expected);
  assert.notEqual(next.turn.activePlayerIndex, state.turn.activePlayerIndex);
  assert.ok(next.map.regions.every((region) => region.units.length <= UNIT_CAP));
});

test("AI only chooses legal attacks and can complete its turn", () => {
  let state = createGame(gameConfig());
  state = endTurn(state);
  const legal = getLegalAttacks(state);
  const choice = chooseAiAttack(state, 0);
  if (choice) assert.ok(legal.some((attack) => attack.sourceId === choice.sourceId && attack.targetId === choice.targetId));
  const result = playAiTurn(state);
  assert.ok(result.attacks >= 0);
  assert.ok(validateGameState(result.state));
});

test("valid games round-trip and invalid save data is rejected", () => {
  const state = createGame(gameConfig());
  const restored = deserializeGame(serializeGame(state));
  assert.deepEqual(restored, state);
  assert.equal(deserializeGame("not json"), null);
  assert.equal(deserializeGame(JSON.stringify({ schemaVersion: 99 })), null);
});
