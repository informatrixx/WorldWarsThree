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
  getLegalAttacks,
  getLegalCardTargets,
  getLegalTargets,
  playCard,
  requiresCardDiscard,
  resolveAttack,
  serializeGame,
  SUPPLY_RATES,
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
    attackerTerrainBonus: 4,
    defenderTerrainBonus: 0,
    attackerCardBonus: 0,
    defenderCardBonus: 0,
  });

  target.terrain = "forest";
  assert.deepEqual(getBattleModifierSummary(state, sourceId, targetId), {
    attackerBonus: 2,
    defenderBonus: 1,
    netBonus: 1,
    attackerTerrainBonus: 2,
    defenderTerrainBonus: 1,
    attackerCardBonus: 0,
    defenderCardBonus: 0,
  });

  source.units = ["infantry", "infantry"];
  target.units = ["infantry", "infantry", "infantry"];
  assert.deepEqual(getBattleModifierSummary(state, sourceId, targetId), {
    attackerBonus: 0,
    defenderBonus: 3,
    netBonus: -3,
    attackerTerrainBonus: 0,
    defenderTerrainBonus: 3,
    attackerCardBonus: 0,
    defenderCardBonus: 0,
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
  const migrated = deserializeGame(JSON.stringify(versionOne));
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.config.cardsEnabled, false);
  assert.ok(migrated.players.every((player) => player.hand.length === 0));
});
