import test from "node:test";
import assert from "node:assert/strict";

import { chooseAiAttack, playAiTurn } from "../src/core/ai.js";
import {
  calculateReinforcements,
  computeBattleOdds,
  createGame,
  deserializeGame,
  endTurn,
  getBattleModifierSummary,
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

test("headquarters are structurally unreachable throughout the first round", () => {
  for (const mapSize of ["small", "medium", "large"]) {
    for (let playerCount = 2; playerCount <= 6; playerCount += 1) {
      for (let sample = 0; sample < 6; sample += 1) {
        const state = createGame(gameConfig({
          mapSize,
          playerCount,
          seed: `safe-hq-${mapSize}-${playerCount}-${sample}`,
        }));
        const distances = state.players.map((player) => {
          const result = Array(state.map.regions.length).fill(Infinity);
          result[player.headquartersRegionId] = 0;
          const queue = [player.headquartersRegionId];
          for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const regionId = queue[cursor];
            for (const neighborId of state.map.regions[regionId].neighbors) {
              if (result[neighborId] !== Infinity) continue;
              result[neighborId] = result[regionId] + 1;
              queue.push(neighborId);
            }
          }
          return result;
        });

        const ownedCounts = state.players.map((player) => (
          state.map.regions.filter((region) => region.ownerId === player.id).length
        ));
        for (const player of state.players) {
          const expectedCoreSize = Math.min(4, Math.max(2, Math.floor(ownedCounts[player.id] / 3)));
          const connected = new Set([player.headquartersRegionId]);
          const queue = [player.headquartersRegionId];
          for (let cursor = 0; cursor < queue.length; cursor += 1) {
            for (const neighborId of state.map.regions[queue[cursor]].neighbors) {
              if (connected.has(neighborId) || state.map.regions[neighborId].ownerId !== player.id) continue;
              connected.add(neighborId);
              queue.push(neighborId);
            }
          }
          assert.ok(connected.size >= expectedCoreSize, "HQ must have a connected home cluster");
        }

        for (const region of state.map.regions) {
          const nearestEnemyHeadquarters = Math.min(...state.players
            .filter((player) => player.id !== region.ownerId)
            .map((player) => distances[player.id][region.id]));
          assert.ok(
            region.units.length <= nearestEnemyHeadquarters,
            "a starting army must run out of movable units before reaching an enemy HQ",
          );
        }

        for (let playerIndex = 0; playerIndex < state.players.length; playerIndex += 1) {
          state.turn.activePlayerIndex = playerIndex;
          assert.ok(getLegalAttacks(state).every(
            ({ targetId }) => !state.map.regions[targetId].isHeadquarters,
          ), "no player may directly attack an HQ on their opening turn");
        }
      }
    }
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

test("battle modifier summaries expose relative terrain and class bonuses", () => {
  const state = createGame(gameConfig({ playerCount: 2 }));
  const { sourceId, targetId } = firstLegalAttack(state);
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  source.units = ["armor", "armor", "artillery", "artillery", "artillery"];
  target.units = ["infantry", "armor"];

  target.terrain = "plains";
  assert.deepEqual(getBattleModifierSummary(state, sourceId, targetId), {
    attackerBonus: 4,
    defenderBonus: 0,
    netBonus: 4,
  });

  target.terrain = "forest";
  assert.deepEqual(getBattleModifierSummary(state, sourceId, targetId), {
    attackerBonus: 2,
    defenderBonus: 1,
    netBonus: 1,
  });

  source.units = ["infantry", "infantry"];
  target.units = ["infantry", "infantry", "infantry"];
  assert.deepEqual(getBattleModifierSummary(state, sourceId, targetId), {
    attackerBonus: 0,
    defenderBonus: 3,
    netBonus: -3,
  });

  target.terrain = "plains";
  assert.equal(getBattleModifierSummary(state, sourceId, targetId).netBonus, 0);
  assert.equal(getBattleModifierSummary(state, -1, targetId), null);
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
  assert.equal(result.state.players[defenderId].headquartersRegionId, null);
  assert.equal(result.state.map.regions[targetId].isHeadquarters, false);
  assert.ok(result.state.map.regions.every((region) => region.ownerId !== defenderId));
  assert.equal(result.state.phase, "finished");
  assert.equal(result.state.winnerId, attackerId);
  const restored = deserializeGame(serializeGame(result.state));
  assert.equal(restored.map.regions[targetId].isHeadquarters, false);
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
