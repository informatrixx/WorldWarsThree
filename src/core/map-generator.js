import { SeededRandom } from "./random.js";

export const MAP_SIZES = Object.freeze({
  small: 36,
  medium: 60,
  large: 90,
});

export const HEX_SIZE = 25;

const DIRECTIONS = Object.freeze([
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
]);

export function cellKey(q, r) {
  return `${q},${r}`;
}

export function parseCellKey(key) {
  return key.split(",").map(Number);
}

export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function getCellCenter(q, r, size = HEX_SIZE) {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: size * 1.5 * r,
  };
}

export function getHexPoints(q, r, size = HEX_SIZE) {
  const center = getCellCenter(q, r, size);
  return Array.from({ length: 6 }, (_, index) => {
    const angle = ((60 * index - 30) * Math.PI) / 180;
    return {
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle),
    };
  });
}

function cubeRound(q, r) {
  const x = q;
  const z = r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

function hexLine(start, end) {
  const distance = hexDistance(start, end);
  if (distance === 0) return [start];
  return Array.from({ length: distance + 1 }, (_, index) => {
    const amount = index / distance;
    return cubeRound(
      start.q + (end.q - start.q) * amount,
      start.r + (end.r - start.r) * amount,
    );
  });
}

function adjacentCells(cell) {
  return DIRECTIONS.map(([dq, dr]) => ({ q: cell.q + dq, r: cell.r + dr }));
}

function growBlob(center, quota, rng, globalLand) {
  const local = new Set([cellKey(center.q, center.r)]);
  globalLand.add(cellKey(center.q, center.r));
  const frontier = new Map();
  const addFrontier = (cell) => {
    const key = cellKey(cell.q, cell.r);
    if (!local.has(key)) frontier.set(key, cell);
  };
  adjacentCells(center).forEach(addFrontier);

  while (local.size < quota && frontier.size) {
    const options = [...frontier.values()].map((cell) => {
      const friendlyNeighbors = adjacentCells(cell)
        .filter((neighbor) => local.has(cellKey(neighbor.q, neighbor.r))).length;
      const distance = hexDistance(cell, center);
      return {
        cell,
        weight: (1 + friendlyNeighbors * friendlyNeighbors * 1.8) / (1 + distance * 0.18),
      };
    });
    const selected = rng.weighted(options).cell;
    const selectedKey = cellKey(selected.q, selected.r);
    frontier.delete(selectedKey);
    local.add(selectedKey);
    globalLand.add(selectedKey);
    adjacentCells(selected).forEach(addFrontier);
  }
}

function addCorridor(land, start, end, width, rng) {
  for (const cell of hexLine(start, end)) {
    land.add(cellKey(cell.q, cell.r));
    if (width > 1) {
      const side = rng.pick(adjacentCells(cell));
      land.add(cellKey(side.q, side.r));
    }
  }
}

function growConnectedLand(land, target, rng) {
  while (land.size < target) {
    const origins = rng.shuffle([...land]).slice(0, Math.min(80, land.size));
    const candidates = new Map();
    for (const key of origins) {
      const [q, r] = parseCellKey(key);
      for (const neighbor of adjacentCells({ q, r })) {
        const neighborKey = cellKey(neighbor.q, neighbor.r);
        if (!land.has(neighborKey)) candidates.set(neighborKey, neighbor);
      }
    }
    if (!candidates.size) break;
    const selected = rng.weighted([...candidates.values()].map((cell) => ({
      cell,
      weight: 1 + adjacentCells(cell).filter((neighbor) => land.has(cellKey(neighbor.q, neighbor.r))).length ** 2,
    }))).cell;
    land.add(cellKey(selected.q, selected.r));
  }
}

function createLand(targetRegions, profile, rng) {
  const targetCells = targetRegions * 5;
  const lobeCount = profile === "open" ? 1 : profile === "mixed" ? 3 : 5;
  const land = new Set();
  const centers = [];
  const spread = profile === "open"
    ? 0
    : Math.ceil(Math.sqrt(targetCells / lobeCount) * 2.15);

  for (let index = 0; index < lobeCount; index += 1) {
    if (lobeCount === 1) {
      centers.push({ q: 0, r: 0 });
      continue;
    }
    const angle = (Math.PI * 2 * index) / lobeCount + rng.next() * 0.28;
    centers.push({
      q: Math.round(Math.cos(angle) * spread),
      r: Math.round(Math.sin(angle) * spread),
    });
  }

  const fillRatio = profile === "open" ? 1 : profile === "mixed" ? 0.86 : 0.78;
  const quota = Math.ceil((targetCells * fillRatio) / lobeCount);
  centers.forEach((center) => growBlob(center, quota, rng, land));

  if (centers.length > 1) {
    for (let index = 1; index < centers.length; index += 1) {
      const width = profile === "mixed" && rng.next() > 0.45 ? 2 : 1;
      addCorridor(land, centers[index - 1], centers[index], width, rng);
    }
  }
  growConnectedLand(land, targetCells, rng);
  return land;
}

function selectRegionSeeds(cells, count, rng) {
  const seeds = [rng.pick(cells)];
  while (seeds.length < count) {
    const candidates = rng.shuffle(cells).slice(0, Math.min(cells.length, 260));
    let best = null;
    let bestScore = -Infinity;
    for (const cell of candidates) {
      if (seeds.some((seed) => seed.q === cell.q && seed.r === cell.r)) continue;
      const nearest = Math.min(...seeds.map((seed) => hexDistance(seed, cell)));
      const score = nearest + rng.next() * 0.35;
      if (score > bestScore) {
        best = cell;
        bestScore = score;
      }
    }
    if (!best) break;
    seeds.push(best);
  }
  return seeds;
}

function partitionLand(land, regionCount, rng) {
  const cells = [...land].map((key) => {
    const [q, r] = parseCellKey(key);
    return { q, r };
  });
  const seeds = selectRegionSeeds(cells, regionCount, rng);
  const assignment = new Map();
  const queue = rng.shuffle(seeds.map((cell, regionId) => ({ cell, regionId })));
  queue.forEach(({ cell, regionId }) => assignment.set(cellKey(cell.q, cell.r), regionId));

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { cell, regionId } = queue[cursor];
    for (const neighbor of rng.shuffle(adjacentCells(cell))) {
      const key = cellKey(neighbor.q, neighbor.r);
      if (!land.has(key) || assignment.has(key)) continue;
      assignment.set(key, regionId);
      queue.push({ cell: neighbor, regionId });
    }
  }

  return { cells, assignment };
}

function buildRegions(cells, assignment, count) {
  const regions = Array.from({ length: count }, (_, id) => ({
    id,
    cells: [],
    neighbors: [],
    terrain: "plains",
    ownerId: null,
    units: [],
    isHeadquarters: false,
    center: { x: 0, y: 0 },
  }));
  const neighborSets = regions.map(() => new Set());

  for (const cell of cells) {
    const key = cellKey(cell.q, cell.r);
    const regionId = assignment.get(key);
    regions[regionId].cells.push({ q: cell.q, r: cell.r });
    for (const neighbor of adjacentCells(cell)) {
      const neighborRegion = assignment.get(cellKey(neighbor.q, neighbor.r));
      if (neighborRegion !== undefined && neighborRegion !== regionId) {
        neighborSets[regionId].add(neighborRegion);
      }
    }
  }

  for (const region of regions) {
    const centers = region.cells.map((cell) => getCellCenter(cell.q, cell.r));
    region.center = {
      x: centers.reduce((sum, center) => sum + center.x, 0) / centers.length,
      y: centers.reduce((sum, center) => sum + center.y, 0) / centers.length,
    };
    region.neighbors = [...neighborSets[region.id]].sort((a, b) => a - b);
  }
  return regions;
}

function mapBounds(cells) {
  const points = cells.flatMap((cell) => getHexPoints(cell.q, cell.r));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const padding = HEX_SIZE * 2;
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  const maxX = Math.max(...xs) + padding;
  const maxY = Math.max(...ys) + padding;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function generateMap({ size = "medium", seed = "dicefront" } = {}) {
  const regionCount = MAP_SIZES[size];
  if (!regionCount) throw new RangeError(`Unknown map size: ${size}`);
  const rng = new SeededRandom(`${seed}:map`);
  const profileRoll = rng.next();
  const profile = profileRoll < 0.25 ? "open" : profileRoll < 0.75 ? "mixed" : "fractured";
  const land = createLand(regionCount, profile, rng);
  const { cells, assignment } = partitionLand(land, regionCount, rng);
  const regions = buildRegions(cells, assignment, regionCount);
  return {
    size,
    seed: String(seed),
    profile,
    bounds: mapBounds(cells),
    regions,
  };
}

export function regionGraphIsConnected(regions) {
  if (!regions.length) return true;
  const visited = new Set([regions[0].id]);
  const queue = [regions[0].id];
  while (queue.length) {
    const id = queue.shift();
    for (const neighbor of regions[id].neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited.size === regions.length;
}

export function articulationPoints(regions) {
  let time = 0;
  const discovered = new Map();
  const low = new Map();
  const parent = new Map();
  const points = new Set();

  const visit = (id) => {
    discovered.set(id, ++time);
    low.set(id, discovered.get(id));
    let children = 0;
    for (const neighbor of regions[id].neighbors) {
      if (!discovered.has(neighbor)) {
        children += 1;
        parent.set(neighbor, id);
        visit(neighbor);
        low.set(id, Math.min(low.get(id), low.get(neighbor)));
        if (!parent.has(id) && children > 1) points.add(id);
        if (parent.has(id) && low.get(neighbor) >= discovered.get(id)) points.add(id);
      } else if (neighbor !== parent.get(id)) {
        low.set(id, Math.min(low.get(id), discovered.get(neighbor)));
      }
    }
  };
  if (regions.length) visit(regions[0].id);
  return [...points];
}
