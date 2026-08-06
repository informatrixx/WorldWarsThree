import { SeededRandom } from "./random.js";

export const MAP_SIZES = Object.freeze({
  small: 36,
  medium: 60,
  large: 90,
});

export const RIVER_DENSITIES = Object.freeze({
  none: 0,
  few: 0.04,
  normal: 0.08,
  many: 0.14,
});

export const HEX_SIZE = 25;
export const MIN_REGION_CELLS = 4;

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
      const sideIndex = rng.int(0, 2);
      const [firstQ, firstR] = DIRECTIONS[sideIndex];
      const [secondQ, secondR] = DIRECTIONS[sideIndex + 3];
      land.add(cellKey(cell.q + firstQ, cell.r + firstR));
      land.add(cellKey(cell.q + secondQ, cell.r + secondR));
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
  const targetCells = targetRegions * 6;
  const lobeCount = profile === "open" ? 1 : profile === "mixed" ? 2 : 3;
  const land = new Set();
  const centers = [];
  const quotaRatio = profile === "open" ? 1 : profile === "mixed" ? 0.56 : 0.4;
  const quota = Math.ceil(targetCells * quotaRatio);
  const approximateRadius = Math.sqrt(quota / 3);
  const spread = profile === "open" ? 0 : Math.ceil(
    approximateRadius * (profile === "mixed" ? 0.65 : 1.25),
  );

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

  centers.forEach((center) => growBlob(center, quota, rng, land));

  if (centers.length > 1) {
    for (let index = 1; index < centers.length; index += 1) {
      addCorridor(land, centers[index - 1], centers[index], profile === "fractured" ? 1 : 2, rng);
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
  const cellsByKey = new Map(cells.map((cell) => [cellKey(cell.q, cell.r), cell]));

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const seeds = selectRegionSeeds(cells, regionCount, rng);
    const assignment = new Map();
    const regionKeys = Array.from({ length: regionCount }, () => new Set());
    seeds.forEach((cell, regionId) => {
      const key = cellKey(cell.q, cell.r);
      assignment.set(key, regionId);
      regionKeys[regionId].add(key);
    });

    let failed = false;
    while (regionKeys.some((keys) => keys.size < MIN_REGION_CELLS)) {
      const constrained = regionKeys
        .map((keys, regionId) => {
          if (keys.size >= MIN_REGION_CELLS) return null;
          const candidates = new Map();
          for (const key of keys) {
            const cell = cellsByKey.get(key);
            for (const neighbor of adjacentCells(cell)) {
              const neighborKey = cellKey(neighbor.q, neighbor.r);
              if (cellsByKey.has(neighborKey) && !assignment.has(neighborKey)) {
                candidates.set(neighborKey, neighbor);
              }
            }
          }
          return { regionId, keys, candidates: [...candidates.values()] };
        })
        .filter(Boolean)
        .sort((first, second) => (
          first.candidates.length - second.candidates.length
          || first.keys.size - second.keys.size
          || first.regionId - second.regionId
        ));
      const nextRegion = constrained[0];
      if (!nextRegion?.candidates.length) {
        failed = true;
        break;
      }
      const seed = seeds[nextRegion.regionId];
      const selected = rng.weighted(nextRegion.candidates.map((cell) => {
        const friendlyNeighbors = adjacentCells(cell).filter((neighbor) => (
          nextRegion.keys.has(cellKey(neighbor.q, neighbor.r))
        )).length;
        return {
          cell,
          weight: (1 + friendlyNeighbors ** 2 * 2.4) / (1 + hexDistance(seed, cell) * 0.2),
        };
      })).cell;
      const selectedKey = cellKey(selected.q, selected.r);
      assignment.set(selectedKey, nextRegion.regionId);
      regionKeys[nextRegion.regionId].add(selectedKey);
    }
    if (failed) continue;

    while (assignment.size < cells.length) {
      const candidates = cells.filter((cell) => {
        const key = cellKey(cell.q, cell.r);
        return !assignment.has(key) && adjacentCells(cell).some((neighbor) => (
          assignment.has(cellKey(neighbor.q, neighbor.r))
        ));
      });
      if (!candidates.length) {
        failed = true;
        break;
      }
      const selected = rng.weighted(candidates.map((cell) => {
        const assignedNeighbors = adjacentCells(cell).filter((neighbor) => (
          assignment.has(cellKey(neighbor.q, neighbor.r))
        ));
        return { cell, weight: 1 + assignedNeighbors.length ** 2 };
      })).cell;
      const neighborRegions = [...new Set(adjacentCells(selected)
        .map((neighbor) => assignment.get(cellKey(neighbor.q, neighbor.r)))
        .filter((regionId) => regionId !== undefined))];
      const regionId = neighborRegions.sort((first, second) => {
        const firstFriendly = adjacentCells(selected).filter((neighbor) => (
          assignment.get(cellKey(neighbor.q, neighbor.r)) === first
        )).length;
        const secondFriendly = adjacentCells(selected).filter((neighbor) => (
          assignment.get(cellKey(neighbor.q, neighbor.r)) === second
        )).length;
        return secondFriendly - firstFriendly
          || regionKeys[first].size - regionKeys[second].size
          || first - second;
      })[0];
      const selectedKey = cellKey(selected.q, selected.r);
      assignment.set(selectedKey, regionId);
      regionKeys[regionId].add(selectedKey);
    }
    if (!failed) return { cells, assignment };
  }

  throw new Error(`Unable to create ${regionCount} regions with ${MIN_REGION_CELLS} cells each`);
}

function buildRegions(cells, assignment, count) {
  const regions = Array.from({ length: count }, (_, id) => ({
    id,
    cells: [],
    neighbors: [],
    terrain: "plains",
    isCoastal: false,
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

function annotateCoasts(regions, land) {
  regions.forEach((region) => {
    region.isCoastal = region.cells.some((cell) => adjacentCells(cell)
      .some((neighbor) => !land.has(cellKey(neighbor.q, neighbor.r))));
  });
}

function riverPointKey(point) {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
}

function riverEdgeKey(from, to) {
  return [riverPointKey(from), riverPointKey(to)].sort().join("|");
}

function buildBoundaryEdgeGraph(regions) {
  const ownerByCell = new Map();
  regions.forEach((region) => region.cells.forEach((cell) => {
    ownerByCell.set(cellKey(cell.q, cell.r), region.id);
  }));
  const edgeByGeometry = new Map();
  for (const region of regions) {
    for (const cell of region.cells) {
      const corners = getHexPoints(cell.q, cell.r);
      DIRECTIONS.forEach(([dq, dr], directionIndex) => {
        const neighborId = ownerByCell.get(cellKey(cell.q + dq, cell.r + dr));
        if (neighborId === region.id) return;
        const edgeCorners = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]][directionIndex];
        const from = corners[edgeCorners[0]];
        const to = corners[edgeCorners[1]];
        const key = riverEdgeKey(from, to);
        if (edgeByGeometry.has(key)) return;
        const regionPair = neighborId === undefined
          ? [region.id, null]
          : [Math.min(region.id, neighborId), Math.max(region.id, neighborId)];
        edgeByGeometry.set(key, {
          from: { x: Number(from.x.toFixed(2)), y: Number(from.y.toFixed(2)) },
          to: { x: Number(to.x.toFixed(2)), y: Number(to.y.toFixed(2)) },
          pointKeys: [riverPointKey(from), riverPointKey(to)],
          regions: regionPair,
          coastal: neighborId === undefined,
        });
      });
    }
  }
  const edges = [...edgeByGeometry.values()];
  const edgesByPoint = new Map();
  edges.forEach((edge, index) => edge.pointKeys.forEach((key) => {
    if (!edgesByPoint.has(key)) edgesByPoint.set(key, []);
    edgesByPoint.get(key).push(index);
  }));
  const adjacency = edges.map((edge, index) => [...new Set(edge.pointKeys.flatMap((key) => edgesByPoint.get(key)))]
    .filter((neighbor) => neighbor !== index));
  return { edges, adjacency };
}

function distancesFromCoast(edges, adjacency, coastPoints) {
  const distances = edges.map(() => Infinity);
  const queue = [];
  edges.forEach((edge, index) => {
    if (edge.coastal || !edge.pointKeys.some((key) => coastPoints.has(key))) return;
    distances[index] = 0;
    queue.push(index);
  });
  while (queue.length) {
    const current = queue.shift();
    for (const neighbor of adjacency[current]) {
      if (edges[neighbor].coastal) continue;
      if (distances[neighbor] <= distances[current] + 1) continue;
      distances[neighbor] = distances[current] + 1;
      queue.push(neighbor);
    }
  }
  return distances;
}

function findRiverEdgeRoute(start, edges, adjacency, coastPoints, used, rng) {
  const previous = new Map([[start, null]]);
  const queue = [start];
  let coast = null;
  while (queue.length) {
    const current = queue.shift();
    const previousEdge = previous.get(current);
    const entryPoints = previousEdge === null
      ? []
      : edges[current].pointKeys.filter((key) => edges[previousEdge].pointKeys.includes(key));
    const exitsAtSea = edges[current].pointKeys.some((key) => coastPoints.has(key) && !entryPoints.includes(key));
    if (current !== start && exitsAtSea) {
      coast = current;
      break;
    }
    for (const neighbor of rng.shuffle(adjacency[current])) {
      if (edges[neighbor].coastal || used.has(neighbor) || previous.has(neighbor)) continue;
      previous.set(neighbor, current);
      queue.push(neighbor);
    }
  }
  if (coast === null) return [];
  const route = [];
  for (let current = coast; current !== null; current = previous.get(current)) route.unshift(current);
  return route;
}

function orientRiverRoute(route, edges, coastPoints) {
  if (!route.length) return [];
  const oriented = [];
  let currentPoint = null;
  route.forEach((edgeIndex, index) => {
    const edge = edges[edgeIndex];
    if (index === 0) {
      const next = edges[route[index + 1]];
      const shared = next && edge.pointKeys.find((key) => next.pointKeys.includes(key));
      const fromIndex = shared === edge.pointKeys[0] ? 1 : 0;
      const toIndex = fromIndex === 0 ? 1 : 0;
      oriented.push({ from: edge[fromIndex === 0 ? "from" : "to"], to: edge[toIndex === 0 ? "from" : "to"], regions: edge.regions });
      currentPoint = edge.pointKeys[toIndex];
      return;
    }
    const fromIndex = edge.pointKeys[0] === currentPoint ? 0 : 1;
    const toIndex = fromIndex === 0 ? 1 : 0;
    oriented.push({
      from: edge[fromIndex === 0 ? "from" : "to"],
      to: edge[toIndex === 0 ? "from" : "to"],
      regions: edge.regions,
      ...(index === route.length - 1 && coastPoints.has(edge.pointKeys[toIndex]) ? { mouth: true } : {}),
    });
    currentPoint = edge.pointKeys[toIndex];
  });
  return oriented;
}

function selectRivers(regions, density, rng) {
  const ratio = RIVER_DENSITIES[density] ?? RIVER_DENSITIES.normal;
  if (!ratio) return { rivers: [], riverPaths: [], riverRoutes: [] };
  const count = Math.max(1, Math.round(regions.length * ratio));
  const { edges, adjacency } = buildBoundaryEdgeGraph(regions);
  const coastPoints = new Set(edges.filter((edge) => edge.coastal).flatMap((edge) => edge.pointKeys));
  const coastDistances = distancesFromCoast(edges, adjacency, coastPoints);
  const candidates = rng.shuffle(edges.map((edge, index) => ({ edge, index })))
    .filter(({ edge, index }) => !edge.coastal && coastDistances[index] >= 4)
    .sort((first, second) => coastDistances[second.index] - coastDistances[first.index]);
  const used = new Set();
  const riverRoutes = [];
  for (const { index } of candidates) {
    if (riverRoutes.length >= count) break;
    if (used.has(index)) continue;
    const route = findRiverEdgeRoute(index, edges, adjacency, coastPoints, used, rng);
    if (route.length < 5) continue;
    const oriented = orientRiverRoute(route, edges, coastPoints);
    if (!oriented.at(-1)?.mouth) continue;
    route.forEach((edgeIndex) => used.add(edgeIndex));
    riverRoutes.push(oriented);
  }
  const riverPairs = new Set();
  riverRoutes.flat().forEach(({ regions: [first, second] }) => {
    if (second !== null) riverPairs.add(`${Math.min(first, second)}:${Math.max(first, second)}`);
  });
  return {
    rivers: [...riverPairs].map((edge) => edge.split(":").map(Number)),
    riverPaths: [],
    riverRoutes,
  };
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

export function generateMap({ size = "medium", seed = "dicefront", riverDensity = "normal" } = {}) {
  const regionCount = MAP_SIZES[size];
  if (!regionCount) throw new RangeError(`Unknown map size: ${size}`);
  const rng = new SeededRandom(`${seed}:map`);
  const profileRoll = rng.next();
  const profile = profileRoll < 0.4 ? "open" : profileRoll < 0.85 ? "mixed" : "fractured";
  const land = createLand(regionCount, profile, rng);
  const { cells, assignment } = partitionLand(land, regionCount, rng);
  const regions = buildRegions(cells, assignment, regionCount);
  annotateCoasts(regions, land);
  const riverData = selectRivers(regions, riverDensity, new SeededRandom(`${seed}:rivers:${riverDensity}`));
  return {
    size,
    seed: String(seed),
    profile,
    bounds: mapBounds(cells),
    regions,
    rivers: riverData.rivers,
    riverPaths: riverData.riverPaths,
    riverRoutes: riverData.riverRoutes,
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
