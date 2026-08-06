import test from "node:test";
import assert from "node:assert/strict";

import { chooseAiAttack, playAiCards, playAiTurn } from "../src/core/ai.js";
import {
  CARD_DECK_COUNTS,
  calculateReinforcements,
  computeBattleOdds,
  createGame,
  deserializeGame,
  discardCard,
  endTurn,
  getBattleModifierSummary,
  getAvailableStances,
  getRecommendedStance,
  getLegalAttacks,
  getLegalCardTargets,
  getLegalTargets,
  getSupplyNetwork,
  isRegionSupplied,
  playCard,
  requiresCardDiscard,
  resolveAttack,
  serializeGame,
  SUPPLY_RATES,
  TERRAIN_TYPES,
  UNIT_CAP,
  validateGameState,
} from "../src/core/game.js";
import { cellKey, getHexPoints } from "../src/core/map-generator.js";

function gameConfig(overrides = {}) {
  return {
    playerCount: 4,
    mapSize: "small",
    difficulty: "normal",
    victoryMode: "headquarters",
    locale: "de",
    cardsEnabled: false,
    seed: "test-seed",
    ...overrides,
  };
}

function setActiveHand(state, types) {
  const allCards = [
    ...state.cards.drawPile,
    ...state.cards.discardPile,
    ...state.players.flatMap((player) => player.hand),
  ];
  const hand = types.map((type) => {
    const index = allCards.findIndex((card) => card.type === type);
    assert.notEqual(index, -1, `expected a ${type} card`);
    return allCards.splice(index, 1)[0];
  });
  state.cards.drawPile = allCards;
  state.cards.discardPile = [];
  state.players.forEach((player) => { player.hand = []; });
  state.players[state.turn.activePlayerIndex].hand = hand;
  return hand;
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

test("AI commanders receive unique deterministic parody names without affecting the human", () => {
  const first = createGame(gameConfig({ playerCount: 6, seed: "commander-name-test" }));
  const same = createGame(gameConfig({ playerCount: 6, seed: "commander-name-test" }));
  const different = createGame(gameConfig({ playerCount: 6, seed: "other-commander-name-test" }));
  const names = first.players.slice(1).map((player) => player.commanderName);

  assert.equal(first.players[0].commanderName, undefined);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, same.players.slice(1).map((player) => player.commanderName));
  assert.notDeepEqual(names, different.players.slice(1).map((player) => player.commanderName));
  assert.ok(names.every((name) => typeof name === "string" && name.length > 0));

  const unnamedSave = structuredClone(first);
  unnamedSave.players.forEach((player) => { delete player.commanderName; });
  const restored = deserializeGame(JSON.stringify(unnamedSave));
  assert.deepEqual(restored.players.slice(1).map((player) => player.commanderName), names);
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
  target.isCoastal = false;
  state.map.rivers = [];

  target.terrain = "plains";
  let summary = getBattleModifierSummary(state, sourceId, targetId);
  assert.equal(summary.attackerBonus, 4);
  assert.equal(summary.defenderBonus, 0);
  assert.equal(summary.netBonus, 4);

  target.terrain = "forest";
  summary = getBattleModifierSummary(state, sourceId, targetId);
  assert.equal(summary.attackerBonus, 2);
  assert.equal(summary.defenderBonus, 1);
  assert.equal(summary.netBonus, 1);

  source.units = ["infantry", "infantry"];
  target.units = ["infantry", "infantry", "infantry"];
  summary = getBattleModifierSummary(state, sourceId, targetId);
  assert.equal(summary.attackerBonus, 0);
  assert.equal(summary.defenderBonus, 3);
  assert.equal(summary.netBonus, -3);

  target.terrain = "plains";
  assert.equal(getBattleModifierSummary(state, sourceId, targetId).netBonus, 0);
  assert.equal(getBattleModifierSummary(state, -1, targetId), null);
});

test("river density, coast detection, and swamp terrain are deterministic", () => {
  const none = createGame(gameConfig({ riverDensity: "none", seed: "terrain-expansion" }));
  const normal = createGame(gameConfig({ riverDensity: "normal", seed: "terrain-expansion" }));
  const same = createGame(gameConfig({ riverDensity: "normal", seed: "terrain-expansion" }));
  assert.equal(none.map.rivers.length, 0);
  assert.equal(none.map.riverRoutes.length, 0);
  assert.ok(normal.map.rivers.length > 0);
  assert.deepEqual(normal.map.rivers, same.map.rivers);
  assert.deepEqual(normal.map.riverPaths, same.map.riverPaths);
  assert.deepEqual(normal.map.riverRoutes, same.map.riverRoutes);
  assert.ok(normal.map.riverRoutes.length > 0);
  const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const edgeCorners = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
  const rounded = (value) => Number(value.toFixed(2)) || 0;
  const pointKey = (point) => `${rounded(point.x)},${rounded(point.y)}`;
  const edgeKey = (from, to) => [pointKey(from), pointKey(to)].sort().join("|");
  const land = new Set(normal.map.regions.flatMap((region) => (
    region.cells.map((cell) => cellKey(cell.q, cell.r))
  )));
  const coastEdges = new Set();
  const coastPoints = new Set();
  normal.map.regions.forEach((region) => region.cells.forEach((cell) => {
    const corners = getHexPoints(cell.q, cell.r);
    directions.forEach(([dq, dr], index) => {
      if (land.has(cellKey(cell.q + dq, cell.r + dr))) return;
      const from = corners[edgeCorners[index][0]];
      const to = corners[edgeCorners[index][1]];
      coastEdges.add(edgeKey(from, to));
      coastPoints.add(pointKey(from));
      coastPoints.add(pointKey(to));
    });
  }));
  assert.ok(normal.map.riverRoutes.every((route) => (
    route.length >= 5
    && route.at(-1).mouth === true
    && route.every((segment) => segment.regions.every(Number.isInteger))
    && route.every((segment) => !coastEdges.has(edgeKey(segment.from, segment.to)))
    && route.slice(0, -1).every((segment) => segment.mouth !== true)
    && !coastPoints.has(pointKey(route[0].from))
    && !coastPoints.has(pointKey(route[0].to))
    && coastPoints.has(pointKey(route.at(-1).to))
    && route.at(-1).regions.some((regionId) => normal.map.regions[regionId].isCoastal)
    && route.slice(1).every((segment, index) => (
      Math.abs(route[index].to.x - segment.from.x) < 0.02
      && Math.abs(route[index].to.y - segment.from.y) < 0.02
    ))
  )));
  assert.ok(normal.map.regions.some((region) => region.isCoastal));
  assert.ok(normal.map.regions.some((region) => region.terrain === "swamp"));
  assert.ok(normal.map.regions.every((region) => new Set(region.units).size <= 3));
  assert.ok(TERRAIN_TYPES.includes("swamp"));
});

test("stances strongly boost their matching class while penalizing the others", () => {
  const state = createGame(gameConfig({ playerCount: 2, riverDensity: "none", seed: "stance-test" }));
  const { sourceId, targetId } = firstLegalAttack(state);
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  source.units = ["armor", "infantry"];
  target.units = ["infantry", "armor"];
  target.terrain = "plains";
  target.isCoastal = false;
  const stances = getAvailableStances(state, sourceId, targetId);
  assert.ok(stances.includes("breakthrough"));
  const summary = getBattleModifierSummary(state, sourceId, targetId, "breakthrough");
  assert.equal(summary.attackerStancePenalty, -1);
  assert.equal(summary.attackerStancePrimaryBonus, 1);
  assert.equal(summary.breakthroughBonus, 1);
  assert.equal(summary.attackerTerrainBonus, 1);
  assert.equal(summary.attackerBonus, 2);
  const result = resolveAttack(state, sourceId, targetId, {
    stance: "breakthrough",
    attackerRolls: [4, 4],
    defenderRolls: [1, 1],
  });
  assert.equal(result.battle.stance, "breakthrough");
  assert.equal(result.battle.attackerDice.find((die) => die.type === "armor").modifier, 2);
  assert.equal(result.battle.attackerDice.find((die) => die.type === "infantry").modifier, -1);
});

test("recommended stances maximize battle odds and keep standard on ties", () => {
  const state = createGame(gameConfig({ playerCount: 2, riverDensity: "none", seed: "recommended-stance-test" }));
  const { sourceId, targetId } = firstLegalAttack(state);
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  source.units = ["armor", "armor", "infantry"];
  target.units = ["infantry", "infantry"];
  target.terrain = "plains";
  target.isCoastal = false;
  state.map.rivers = [];

  const recommended = getRecommendedStance(state, sourceId, targetId);
  assert.equal(recommended, "breakthrough");
  assert.ok(computeBattleOdds(state, sourceId, targetId, recommended) > computeBattleOdds(state, sourceId, targetId));

  source.units = ["infantry", "supply", "snipers"];
  target.terrain = "hills";
  assert.equal(getRecommendedStance(state, sourceId, targetId), null);
});

test("a successful strictly riskier manual stance loots a card without overflowing the hand", () => {
  const state = createGame(gameConfig({ cardsEnabled: true, playerCount: 2, riverDensity: "none", seed: "risk-loot-test" }));
  const { sourceId, targetId } = firstLegalAttack(state);
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  source.units = ["armor", "armor", "infantry"];
  target.units = ["infantry"];
  target.terrain = "plains";
  target.isCoastal = false;
  state.map.rivers = [];
  setActiveHand(state, ["supplyDrop"]);

  assert.equal(getRecommendedStance(state, sourceId, targetId), "breakthrough");
  const result = resolveAttack(state, sourceId, targetId, {
    stance: "security",
    attackerRolls: [6, 6, 6],
    defenderRolls: [1],
  });
  assert.equal(result.battle.attackerWon, true);
  assert.ok(result.battle.tacticalLootCardType);
  assert.equal(result.state.players[0].hand.length, 2);
  assert.equal(result.state.log[0].type, "tacticalLoot");

  const fullHand = createGame(gameConfig({ cardsEnabled: true, playerCount: 2, riverDensity: "none", seed: "risk-loot-full-hand-test" }));
  const fullAttack = firstLegalAttack(fullHand);
  fullHand.map.regions[fullAttack.sourceId].units = ["armor", "armor", "infantry"];
  fullHand.map.regions[fullAttack.targetId].units = ["infantry"];
  fullHand.map.regions[fullAttack.targetId].terrain = "plains";
  fullHand.map.regions[fullAttack.targetId].isCoastal = false;
  fullHand.map.rivers = [];
  setActiveHand(fullHand, ["supplyDrop", "redeploy", "fortification"]);
  const noLoot = resolveAttack(fullHand, fullAttack.sourceId, fullAttack.targetId, {
    stance: "security",
    attackerRolls: [6, 6, 6],
    defenderRolls: [1],
  });
  assert.equal(noLoot.battle.tacticalLootCardType, null);
  assert.equal(noLoot.state.players[0].hand.length, 3);

  const automatic = createGame(gameConfig({ cardsEnabled: true, playerCount: 2, riverDensity: "none", seed: "risk-loot-auto-test" }));
  const automaticAttack = firstLegalAttack(automatic);
  automatic.map.regions[automaticAttack.sourceId].units = ["armor", "armor", "infantry"];
  automatic.map.regions[automaticAttack.targetId].units = ["infantry"];
  automatic.map.regions[automaticAttack.targetId].terrain = "plains";
  automatic.map.regions[automaticAttack.targetId].isCoastal = false;
  automatic.map.rivers = [];
  const automaticResult = resolveAttack(automatic, automaticAttack.sourceId, automaticAttack.targetId, {
    stance: getRecommendedStance(automatic, automaticAttack.sourceId, automaticAttack.targetId),
    attackerRolls: [6, 6, 6],
    defenderRolls: [1],
  });
  assert.equal(automaticResult.battle.tacticalLootCardType, null);

  const tied = createGame(gameConfig({ cardsEnabled: true, playerCount: 2, riverDensity: "none", seed: "risk-loot-tie-test" }));
  const tiedAttack = firstLegalAttack(tied);
  tied.map.regions[tiedAttack.sourceId].units = ["infantry", "supply"];
  tied.map.regions[tiedAttack.targetId].units = ["infantry"];
  tied.map.regions[tiedAttack.targetId].terrain = "hills";
  tied.map.regions[tiedAttack.targetId].isCoastal = false;
  tied.map.rivers = [];
  assert.equal(getRecommendedStance(tied, tiedAttack.sourceId, tiedAttack.targetId), null);
  const tiedResult = resolveAttack(tied, tiedAttack.sourceId, tiedAttack.targetId, {
    stance: "security",
    attackerRolls: [6, 6, 6],
    defenderRolls: [1],
  });
  assert.equal(tiedResult.battle.tacticalLootCardType, null);
});

test("pioneers and snipers neutralize their matching terrain penalties", () => {
  const state = createGame(gameConfig({ playerCount: 2, riverDensity: "none", seed: "specialist-terrain-test" }));
  const { sourceId, targetId } = firstLegalAttack(state);
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  target.terrain = "swamp";
  target.isCoastal = true;
  state.map.rivers = [[sourceId, targetId]];
  source.units = ["pioneers", "snipers"];
  target.units = ["infantry", "infantry"];
  const engineering = getBattleModifierSummary(state, sourceId, targetId, "engineering");
  assert.equal(engineering.riverPenalty, 1);
  assert.equal(engineering.swampPenalty, 1);
  assert.equal(engineering.neutralizedTerrainPenalty, 2);
  const recon = getBattleModifierSummary(state, sourceId, targetId, "recon");
  assert.equal(recon.coastalPenalty, 1);
  assert.equal(recon.neutralizedTerrainPenalty, 1);
});

test("supply stance boosts the next reinforcement only once per turn", () => {
  const state = createGame(gameConfig({ playerCount: 2, riverDensity: "none", seed: "supply-stance-test" }));
  const { sourceId, targetId } = firstLegalAttack(state);
  state.map.regions[sourceId].units = ["supply", "infantry"];
  state.map.regions[targetId].units = ["infantry"];
  state.map.regions[targetId].isHeadquarters = false;
  const result = resolveAttack(state, sourceId, targetId, {
    stance: "supplySurge",
    attackerRolls: [6, 6],
    defenderRolls: [1],
  });
  assert.equal(result.state.turn.supplyBoostUsed, true);
  assert.equal(getAvailableStances(result.state, sourceId).includes("supplySurge"), false);
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
  state.turn.round = 2;
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

test("supply strength scales reinforcements and preserves the low default", () => {
  const lowState = createGame(gameConfig({ supplyRate: "low", seed: "supply-rate-test" }));
  const playerId = lowState.players[lowState.turn.activePlayerIndex].id;
  const lowSupply = calculateReinforcements(lowState, playerId);
  assert.equal(createGame(gameConfig()).config.supplyRate, "low");

  for (const [supplyRate, multiplier] of Object.entries(SUPPLY_RATES)) {
    const state = createGame(gameConfig({ supplyRate, seed: "supply-rate-test" }));
    assert.equal(calculateReinforcements(state, playerId), Math.ceil(lowSupply * multiplier));
  }

  const highState = createGame(gameConfig({ supplyRate: "veryHigh", seed: "supply-rate-turn" }));
  const expected = calculateReinforcements(highState, 0);
  const next = endTurn(highState);
  assert.equal(next.log.find((entry) => entry.type === "reinforcements").requested, expected);
  assert.throws(() => createGame(gameConfig({ supplyRate: "unlimited" })), /Unknown supply rate/);
});

test("HQ and city supply networks prioritize supplied regions and apply defense-only isolation penalty", () => {
  const state = createGame(gameConfig({ cardsEnabled: false, seed: "supply-network-test" }));
  const supplied = getSupplyNetwork(state, 0);
  const owned = state.map.regions.filter((region) => region.ownerId === 0);
  assert.ok(supplied.size > 0);
  assert.ok(owned.some((region) => !supplied.has(region.id)), "seed should contain a cut-off region");
  const target = owned.find((region) => !supplied.has(region.id) && region.units.length > 1 && region.terrain !== "city");
  const source = target && state.map.regions[target.neighbors.find((id) => state.map.regions[id].ownerId === 0) ?? target.neighbors[0]];
  assert.ok(target && source, "seed should contain a cut-off region with a neighboring source");
  source.ownerId = 0;
  source.units = ["infantry", "armor", "artillery"];
  target.ownerId = 1;
  target.units = ["infantry", "armor", "artillery"];
  state.cards.effects.push({ type: "interdiction", playerId: 0, regionId: target.id, targetOwnerId: 1, cardId: "test-interdiction", untilRound: state.turn.round + 1 });
  const attack = getLegalAttacks(state).find((candidate) => candidate.sourceId === source.id && candidate.targetId === target.id);
  assert.ok(attack, "cut-off region should have a neighboring attacker");
  const result = resolveAttack(state, attack.sourceId, attack.targetId, { attackerRolls: [6, 6, 6, 6, 6, 6, 6, 6], defenderRolls: [1, 1, 1, 1] });
  assert.equal(result.battle.defenderSupplyPenalty, 1);
  assert.equal(result.battle.defenderDice.length, target.units.length - 1);
  assert.equal(isRegionSupplied(state, target.id, target.ownerId), false);
  target.units = ["infantry", "armor", "artillery"];
  state.players[target.ownerId].skills = ["fortressDoctrine"];
  const fortified = resolveAttack(state, attack.sourceId, attack.targetId, { attackerRolls: [1], defenderRolls: [1, 1, 1] });
  assert.equal(fortified.battle.defenderSupplyPenalty, 0);
  assert.equal(fortified.battle.defenderDice.length, 3);
});

test("unlockable supply cards can be selected in a constrained card pool", () => {
  const state = createGame(gameConfig({ cardsEnabled: true, cardPool: ["supplyConvoy", "interdiction"], seed: "unlockable-cards-test" }));
  const human = state.players[0];
  const allCards = [...state.cards.drawPile, ...human.hand];
  const convoy = allCards.find((card) => card.type === "supplyConvoy");
  const target = state.map.regions.find((region) => region.ownerId === 0 && region.units.length < UNIT_CAP
    && getSupplyNetwork(state, 0).has(region.id));
  assert.ok(convoy && target);
  human.hand = [convoy];
  state.cards.drawPile = allCards.filter((card) => card.id !== convoy.id);
  const before = target.units.length;
  const result = playCard(state, convoy.id, { targetId: target.id });
  assert.equal(result.result.cardType, "supplyConvoy");
  assert.ok(result.state.map.regions[target.id].units.length > before);
  assert.equal(validateGameState(result.state), true);
});

test("AI only chooses legal attacks and can complete its turn", () => {
  let state = createGame(gameConfig());
  state = endTurn(state);
  const legal = getLegalAttacks(state);
  const choice = chooseAiAttack(state, 0);
  if (choice) {
    assert.ok(legal.some((attack) => attack.sourceId === choice.sourceId && attack.targetId === choice.targetId));
    assert.equal(choice.stance, getRecommendedStance(state, choice.sourceId, choice.targetId));
  }
  const result = playAiTurn(state);
  assert.ok(result.attacks >= 0);
  assert.ok(validateGameState(result.state));
});

test("the deterministic card deck draws at turn start and enforces a four-card discard", () => {
  const state = createGame(gameConfig({ cardsEnabled: true, seed: "card-deck-test" }));
  const same = createGame(gameConfig({ cardsEnabled: true, seed: "card-deck-test" }));
  const deckSize = Object.values(CARD_DECK_COUNTS).reduce((sum, count) => sum + count, 0);
  assert.equal(state.config.cardsEnabled, true);
  assert.equal(state.players[0].hand.length, 1);
  assert.equal(state.cards.drawPile.length, deckSize - 1);
  assert.deepEqual(state.cards, same.cards);

  setActiveHand(state, ["supplyDrop", "redeploy", "fortification"]);
  let next = state;
  do next = endTurn(next); while (next.turn.activePlayerIndex !== 0);
  assert.equal(next.players[0].hand.length, 4);
  assert.equal(requiresCardDiscard(next), true);
  assert.deepEqual(getLegalAttacks(next), []);
  next = discardCard(next, next.players[0].hand[0].id);
  assert.equal(next.players[0].hand.length, 3);
  assert.equal(requiresCardDiscard(next), false);
  assert.ok(validateGameState(next));
});

test("supply, redeployment, and mobilization respect ownership and unit caps", () => {
  let state = createGame(gameConfig({ cardsEnabled: true, playerCount: 2, seed: "strategic-card-test" }));
  const ownedPair = state.map.regions
    .map((source) => ({ source, target: source.neighbors.map((id) => state.map.regions[id]).find((region) => region.ownerId === source.ownerId) }))
    .find(({ source, target }) => source.ownerId === 0 && target);
  ownedPair.source.units = ["infantry", "armor", "artillery"];
  ownedPair.target.units = ["infantry"];

  let [card] = setActiveHand(state, ["redeploy"]);
  state = playCard(state, card.id, { sourceId: ownedPair.source.id, targetId: ownedPair.target.id }).state;
  assert.deepEqual(state.map.regions[ownedPair.source.id].units, ["infantry"]);
  assert.deepEqual(state.map.regions[ownedPair.target.id].units.sort(), ["armor", "artillery", "infantry"].sort());

  [card] = setActiveHand(state, ["supplyDrop"]);
  const supplyTarget = state.map.regions[ownedPair.source.id];
  const beforeSupply = supplyTarget.units.length;
  state = playCard(state, card.id, { targetId: supplyTarget.id }).state;
  assert.equal(state.map.regions[supplyTarget.id].units.length, Math.min(UNIT_CAP, beforeSupply + 2));

  [card] = setActiveHand(state, ["mobilization"]);
  const beforeTotal = state.map.regions.reduce((sum, region) => sum + region.units.length, 0);
  const targetId = getLegalCardTargets(state, card.id)[0];
  const mobilized = playCard(state, card.id, { targetId });
  const afterTotal = mobilized.state.map.regions.reduce((sum, region) => sum + region.units.length, 0);
  assert.ok(afterTotal > beforeTotal && afterTotal - beforeTotal <= 4);
  assert.ok(mobilized.state.map.regions.every((region) => region.units.length <= UNIT_CAP));
});

test("stacked combat cards modify totals, reroll low dice, and are consumed", () => {
  let state = createGame(gameConfig({ cardsEnabled: true, playerCount: 2, seed: "combat-card-test" }));
  const { sourceId, targetId } = firstLegalAttack(state);
  state.map.regions[sourceId].units = ["infantry", "infantry"];
  state.map.regions[targetId].units = ["infantry"];
  const hand = setActiveHand(state, ["fireSupport", "fireSupport", "luckyRoll"]);
  for (const card of hand) state = playCard(state, card.id, { targetId: sourceId }).state;
  assert.equal(getBattleModifierSummary(state, sourceId, targetId).attackerCardBonus, 6);
  const baseOdds = computeBattleOdds(createGame(gameConfig({ playerCount: 2, seed: "combat-card-test" })), sourceId, targetId);
  assert.ok(computeBattleOdds(state, sourceId, targetId) > baseOdds);

  const result = resolveAttack(state, sourceId, targetId, {
    attackerRolls: [1, 2],
    attackerRerolls: [[6, 5]],
    defenderRolls: [6],
  });
  assert.equal(result.battle.attackerCardBonus, 6);
  assert.equal(result.battle.luckyRerolls, 1);
  assert.deepEqual(result.battle.attackerDice.map((die) => die.base), [6, 5]);
  assert.equal(result.state.cards.effects.length, 0);
});

test("fortification is consumed by the next defense and HQs are blocked throughout round one", () => {
  let state = createGame(gameConfig({ cardsEnabled: true, playerCount: 2, seed: "defense-card-test" }));
  const { sourceId, targetId } = firstLegalAttack(state);
  const defenderId = state.map.regions[targetId].ownerId;
  state.turn.activePlayerIndex = defenderId;
  const [card] = setActiveHand(state, ["fortification"]);
  state = playCard(state, card.id, { targetId }).state;
  state.turn.activePlayerIndex = state.map.regions[sourceId].ownerId;
  state.map.regions[targetId].isHeadquarters = true;
  assert.equal(getLegalTargets(state, sourceId).includes(targetId), false);
  state.turn.round = 2;
  assert.equal(getLegalTargets(state, sourceId).includes(targetId), true);
  const result = resolveAttack(state, sourceId, targetId, {
    attackerRolls: Array(state.map.regions[sourceId].units.length).fill(1),
    defenderRolls: Array(state.map.regions[targetId].units.length).fill(1),
  });
  assert.equal(result.battle.defenderCardBonus, 3);
  assert.equal(result.state.cards.effects.some((effect) => effect.type === "fortification"), false);
});

test("AI resolves card overflow and plays useful tactical cards", () => {
  let state = createGame(gameConfig({ cardsEnabled: true, playerCount: 2, seed: "ai-card-test" }));
  state = endTurn(state);
  setActiveHand(state, ["mobilization", "supplyDrop", "fortification", "redeploy"]);
  const result = playAiCards(state);
  assert.equal(result.discarded, 1);
  assert.ok(result.played >= 1);
  assert.ok(validateGameState(result.state));
});

test("valid games round-trip and invalid save data is rejected", () => {
  const state = createGame(gameConfig());
  const restored = deserializeGame(serializeGame(state));
  assert.deepEqual(restored, state);
  assert.equal(deserializeGame("not json"), null);
  assert.equal(deserializeGame(JSON.stringify({ schemaVersion: 99 })), null);
  assert.equal(deserializeGame(JSON.stringify({ ...state, config: { ...state.config, supplyRate: "invalid" } })), null);
  const legacyState = structuredClone(state);
  delete legacyState.config.supplyRate;
  const restoredLegacy = deserializeGame(JSON.stringify(legacyState));
  assert.ok(restoredLegacy);
  assert.equal(calculateReinforcements(restoredLegacy, 0), calculateReinforcements(state, 0));

  const versionOne = structuredClone(state);
  versionOne.schemaVersion = 1;
  delete versionOne.config.cardsEnabled;
  delete versionOne.cards;
  versionOne.players.forEach((player) => { delete player.hand; });
  assert.equal(deserializeGame(JSON.stringify(versionOne)), null);
});

test("schema v3 saves migrate with default supply and skill fields", () => {
  const current = createGame(gameConfig({ cardsEnabled: false, seed: "migration-test" }));
  const legacy = JSON.parse(serializeGame(current));
  legacy.schemaVersion = 3;
  delete legacy.config.cardPool;
  delete legacy.config.skillPool;
  delete legacy.config.skillSlots;
  delete legacy.config.skillLoadout;
  legacy.players.forEach((player) => { delete player.skills; });
  const migrated = deserializeGame(JSON.stringify(legacy));
  assert.ok(migrated);
  assert.equal(migrated.schemaVersion, 5);
  assert.deepEqual(migrated.players.map((player) => player.skills), [[], [], [], []]);
});
