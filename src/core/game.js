import { generateMap, MAP_SIZES } from "./map-generator.js";
import { randomSeed, SeededRandom } from "./random.js";

export const SCHEMA_VERSION = 1;
export const UNIT_CAP = 8;
export const UNIT_TYPES = Object.freeze(["infantry", "armor", "artillery"]);
export const TERRAIN_TYPES = Object.freeze(["plains", "forest", "hills", "city"]);
export const VICTORY_MODES = Object.freeze(["conquest", "headquarters"]);
export const DIFFICULTIES = Object.freeze(["easy", "normal", "hard"]);

export const PLAYER_STYLES = Object.freeze([
  { color: "#33b8a6", accent: "#8af2e1", pattern: "diagonal" },
  { color: "#e05c55", accent: "#ffaaa4", pattern: "dots" },
  { color: "#d9a441", accent: "#ffe09b", pattern: "cross" },
  { color: "#7c69d7", accent: "#c1b6ff", pattern: "waves" },
  { color: "#448dd1", accent: "#9fd2ff", pattern: "grid" },
  { color: "#c56baa", accent: "#ffc0ea", pattern: "chevron" },
]);

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function normalizeConfig(config = {}) {
  const playerCount = Number(config.playerCount ?? 4);
  const mapSize = config.mapSize ?? "medium";
  const difficulty = config.difficulty ?? "normal";
  const victoryMode = config.victoryMode ?? "headquarters";
  const locale = config.locale === "en" ? "en" : "de";
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
    throw new RangeError("playerCount must be an integer between 2 and 6");
  }
  if (!MAP_SIZES[mapSize]) throw new RangeError(`Unknown map size: ${mapSize}`);
  if (!DIFFICULTIES.includes(difficulty)) throw new RangeError(`Unknown difficulty: ${difficulty}`);
  if (!VICTORY_MODES.includes(victoryMode)) throw new RangeError(`Unknown victory mode: ${victoryMode}`);
  return {
    playerCount,
    mapSize,
    difficulty,
    victoryMode,
    locale,
    seed: String(config.seed || randomSeed()),
  };
}

function assignOwners(regions, players, rng) {
  const shuffled = rng.shuffle(regions.map((region) => region.id));
  const offset = rng.int(0, players.length - 1);
  shuffled.forEach((regionId, index) => {
    regions[regionId].ownerId = players[(index + offset) % players.length].id;
  });
}

function assignBalancedTerrain(regions, players, rng) {
  for (const player of players) {
    const owned = rng.shuffle(regions.filter((region) => region.ownerId === player.id));
    const cityCount = Math.max(1, Math.floor(owned.length / 8));
    const forestCount = Math.min(owned.length - cityCount, Math.round(owned.length * 0.25));
    const hillCount = Math.min(
      owned.length - cityCount - forestCount,
      Math.round(owned.length * 0.18),
    );
    owned.forEach((region, index) => {
      if (index < cityCount) region.terrain = "city";
      else if (index < cityCount + forestCount) region.terrain = "forest";
      else if (index < cityCount + forestCount + hillCount) region.terrain = "hills";
      else region.terrain = "plains";
    });
  }
}

function classPool(total, rng) {
  const infantry = Math.round(total * 0.5);
  const armor = Math.round(total * 0.3);
  const artillery = total - infantry - armor;
  return rng.shuffle([
    ...Array(infantry).fill("infantry"),
    ...Array(armor).fill("armor"),
    ...Array(artillery).fill("artillery"),
  ]);
}

function assignBalancedUnits(regions, players, rng) {
  const budget = Math.max(12, 3 * Math.ceil(regions.length / players.length));
  for (const player of players) {
    const owned = rng.shuffle(regions.filter((region) => region.ownerId === player.id));
    const pool = classPool(budget, rng);
    owned.forEach((region) => {
      region.units.push(pool.pop());
    });
    while (pool.length) {
      const eligible = owned.filter((region) => region.units.length < UNIT_CAP);
      if (!eligible.length) break;
      rng.pick(eligible).units.push(pool.pop());
    }
  }
  return budget;
}

function squaredDistance(first, second) {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function placeHeadquarters(regions, players, rng) {
  const selected = [];
  for (const player of players) {
    const candidates = regions.filter((region) => region.ownerId === player.id);
    let headquarters;
    if (!selected.length) {
      headquarters = rng.pick(candidates);
    } else {
      headquarters = candidates
        .map((region) => ({
          region,
          distance: Math.min(...selected.map((other) => squaredDistance(region.center, other.center))),
        }))
        .sort((a, b) => b.distance - a.distance)[0].region;
    }
    headquarters.isHeadquarters = true;
    player.headquartersRegionId = headquarters.id;
    selected.push(headquarters);
  }
}

export function createGame(inputConfig = {}) {
  const config = normalizeConfig(inputConfig);
  const map = generateMap({ size: config.mapSize, seed: config.seed });
  const rng = new SeededRandom(`${config.seed}:game`);
  const players = Array.from({ length: config.playerCount }, (_, index) => ({
    id: index,
    style: PLAYER_STYLES[index],
    isHuman: index === 0,
    active: true,
    headquartersRegionId: null,
  }));
  assignOwners(map.regions, players, rng);
  assignBalancedTerrain(map.regions, players, rng);
  const startingUnitBudget = assignBalancedUnits(map.regions, players, rng);
  placeHeadquarters(map.regions, players, rng);

  return {
    schemaVersion: SCHEMA_VERSION,
    config,
    map,
    players,
    startingUnitBudget,
    rngState: rng.state,
    turn: { round: 1, activePlayerIndex: 0 },
    phase: "playing",
    winnerId: null,
    log: [{ type: "gameStarted", round: 1, seed: config.seed }],
  };
}

export function getActivePlayer(state) {
  return state.players[state.turn.activePlayerIndex];
}

export function getLegalTargets(state, sourceId) {
  const source = state.map.regions[sourceId];
  const activePlayer = getActivePlayer(state);
  if (
    state.phase !== "playing"
    || !source
    || source.ownerId !== activePlayer.id
    || source.units.length < 2
  ) return [];
  return source.neighbors.filter((id) => state.map.regions[id].ownerId !== activePlayer.id);
}

export function getLegalAttacks(state) {
  const attacks = [];
  for (const region of state.map.regions) {
    for (const targetId of getLegalTargets(state, region.id)) {
      attacks.push({ sourceId: region.id, targetId });
    }
  }
  return attacks;
}

function dieModifiers(units, terrain, role) {
  let supportedArtillery = 0;
  return units.map((type) => {
    if (type === "infantry" && role === "defender" && ["forest", "city"].includes(terrain)) return 1;
    if (type === "armor" && role === "attacker" && terrain === "plains") return 1;
    if (type === "artillery" && role === "attacker" && supportedArtillery < 2) {
      supportedArtillery += 1;
      return 1;
    }
    return 0;
  });
}

function rollArmy(units, terrain, role, rng, forcedRolls) {
  const modifiers = dieModifiers(units, terrain, role);
  return units.map((type, index) => {
    const base = forcedRolls?.[index] ?? rng.int(1, 6);
    if (!Number.isInteger(base) || base < 1 || base > 6) throw new RangeError("Forced rolls must be W6 results");
    return { type, base, modifier: modifiers[index], total: base + modifiers[index] };
  });
}

function selectGarrison(units) {
  const priority = { infantry: 0, artillery: 1, armor: 2 };
  let selectedIndex = 0;
  units.forEach((type, index) => {
    if (priority[type] < priority[units[selectedIndex]]) selectedIndex = index;
  });
  return {
    garrison: units[selectedIndex],
    remaining: units.filter((_, index) => index !== selectedIndex),
  };
}

function eliminatePlayer(state, defeatedId, victorId) {
  const defeated = state.players.find((player) => player.id === defeatedId);
  if (!defeated?.active) return 0;
  defeated.active = false;
  let transferred = 0;
  for (const region of state.map.regions) {
    if (region.ownerId === defeatedId) {
      region.ownerId = victorId;
      transferred += 1;
    }
  }
  state.log.unshift({ type: "playerEliminated", playerId: defeatedId, victorId, transferred });
  return transferred;
}

function updateEliminationsAndVictory(state) {
  for (const player of state.players) {
    if (player.active && !state.map.regions.some((region) => region.ownerId === player.id)) {
      player.active = false;
      state.log.unshift({ type: "playerEliminated", playerId: player.id, victorId: null, transferred: 0 });
    }
  }
  const active = state.players.filter((player) => player.active);
  if (active.length === 1) {
    state.phase = "finished";
    state.winnerId = active[0].id;
    state.log.unshift({ type: "gameWon", playerId: active[0].id, round: state.turn.round });
  }
}

export function resolveAttack(currentState, sourceId, targetId, options = {}) {
  if (!getLegalTargets(currentState, sourceId).includes(targetId)) {
    throw new Error("Illegal attack");
  }
  const state = clone(currentState);
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  const attackerId = source.ownerId;
  const defenderId = target.ownerId;
  const rng = new SeededRandom(state.rngState);
  const attackerDice = rollArmy(source.units, target.terrain, "attacker", rng, options.attackerRolls);
  const defenderDice = rollArmy(target.units, target.terrain, "defender", rng, options.defenderRolls);
  const attackerTotal = attackerDice.reduce((sum, die) => sum + die.total, 0);
  const defenderTotal = defenderDice.reduce((sum, die) => sum + die.total, 0);
  const attackerWon = attackerTotal > defenderTotal;
  const { garrison, remaining } = selectGarrison(source.units);

  source.units = [garrison];
  if (attackerWon) {
    target.ownerId = attackerId;
    target.units = remaining;
    if (currentState.config.victoryMode === "headquarters" && target.isHeadquarters) {
      eliminatePlayer(state, defenderId, attackerId);
    }
  }
  state.rngState = rng.state;
  const battle = {
    sourceId,
    targetId,
    attackerId,
    defenderId,
    attackerDice,
    defenderDice,
    attackerTotal,
    defenderTotal,
    attackerWon,
  };
  state.log.unshift({ type: "battle", round: state.turn.round, ...battle });
  state.log = state.log.slice(0, 200);
  updateEliminationsAndVictory(state);
  return { state, battle };
}

function connectedRegionCount(state, ownerId) {
  const owned = state.map.regions.filter((region) => region.ownerId === ownerId);
  const unvisited = new Set(owned.map((region) => region.id));
  let largest = 0;
  while (unvisited.size) {
    const first = unvisited.values().next().value;
    unvisited.delete(first);
    const queue = [first];
    let count = 0;
    while (queue.length) {
      const id = queue.shift();
      count += 1;
      for (const neighbor of state.map.regions[id].neighbors) {
        if (unvisited.has(neighbor) && state.map.regions[neighbor].ownerId === ownerId) {
          unvisited.delete(neighbor);
          queue.push(neighbor);
        }
      }
    }
    largest = Math.max(largest, count);
  }
  return largest;
}

export function calculateReinforcements(state, playerId) {
  const owned = state.map.regions.filter((region) => region.ownerId === playerId);
  if (!owned.length) return 0;
  const largestGroup = connectedRegionCount(state, playerId);
  const cities = owned.filter((region) => region.terrain === "city").length;
  return Math.max(1, Math.floor(largestGroup / 3)) + cities;
}

function distributeReinforcements(state, playerId, rng) {
  const requested = calculateReinforcements(state, playerId);
  let placed = 0;
  for (let index = 0; index < requested; index += 1) {
    const eligible = state.map.regions.filter(
      (region) => region.ownerId === playerId && region.units.length < UNIT_CAP,
    );
    if (!eligible.length) break;
    const region = rng.pick(eligible);
    const type = rng.weighted([
      { type: "infantry", weight: 0.5 },
      { type: "armor", weight: 0.3 },
      { type: "artillery", weight: 0.2 },
    ]).type;
    region.units.push(type);
    placed += 1;
  }
  return { requested, placed };
}

export function endTurn(currentState) {
  if (currentState.phase !== "playing") return currentState;
  const state = clone(currentState);
  const player = getActivePlayer(state);
  const rng = new SeededRandom(state.rngState);
  const reinforcement = distributeReinforcements(state, player.id, rng);
  state.rngState = rng.state;
  state.log.unshift({
    type: "reinforcements",
    playerId: player.id,
    amount: reinforcement.placed,
    requested: reinforcement.requested,
    round: state.turn.round,
  });

  const previousIndex = state.turn.activePlayerIndex;
  let nextIndex = previousIndex;
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const candidate = (previousIndex + offset) % state.players.length;
    if (state.players[candidate].active) {
      nextIndex = candidate;
      break;
    }
  }
  state.turn.activePlayerIndex = nextIndex;
  if (nextIndex <= previousIndex) state.turn.round += 1;
  state.log.unshift({ type: "turnStarted", playerId: state.players[nextIndex].id, round: state.turn.round });
  state.log = state.log.slice(0, 200);
  return state;
}

function sumDistribution(modifiers) {
  let distribution = new Map([[0, 1]]);
  for (const modifier of modifiers) {
    const next = new Map();
    for (const [sum, count] of distribution) {
      for (let face = 1; face <= 6; face += 1) {
        const value = sum + face + modifier;
        next.set(value, (next.get(value) ?? 0) + count);
      }
    }
    distribution = next;
  }
  return distribution;
}

export function computeBattleOdds(state, sourceId, targetId) {
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  if (!source || !target) return 0;
  const attacker = sumDistribution(dieModifiers(source.units, target.terrain, "attacker"));
  const defender = sumDistribution(dieModifiers(target.units, target.terrain, "defender"));
  let wins = 0;
  let outcomes = 0;
  for (const [attackerSum, attackerCount] of attacker) {
    for (const [defenderSum, defenderCount] of defender) {
      const combinations = attackerCount * defenderCount;
      outcomes += combinations;
      if (attackerSum > defenderSum) wins += combinations;
    }
  }
  return outcomes ? wins / outcomes : 0;
}

export function serializeGame(state) {
  return JSON.stringify(state);
}

export function validateGameState(state) {
  if (!state || state.schemaVersion !== SCHEMA_VERSION || !state.config || !state.map) return false;
  if (!Array.isArray(state.players) || !Array.isArray(state.map.regions)) return false;
  if (state.players.length < 2 || state.players.length > 6) return false;
  if (!Number.isInteger(state.turn?.activePlayerIndex)) return false;
  if (!state.players[state.turn.activePlayerIndex]) return false;
  return state.map.regions.every((region, index) => (
    region.id === index
    && Array.isArray(region.neighbors)
    && Array.isArray(region.cells)
    && Array.isArray(region.units)
    && region.units.length >= 1
    && region.units.length <= UNIT_CAP
    && region.units.every((unit) => UNIT_TYPES.includes(unit))
    && TERRAIN_TYPES.includes(region.terrain)
    && state.players.some((player) => player.id === region.ownerId)
  ));
}

export function deserializeGame(serialized) {
  try {
    const state = JSON.parse(serialized);
    return validateGameState(state) ? state : null;
  } catch {
    return null;
  }
}
