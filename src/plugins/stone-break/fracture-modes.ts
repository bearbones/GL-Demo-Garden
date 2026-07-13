// Precomputes a slab's "fracture modes" — its cheapest ways to break —
// in the spirit of Sellán et al., "Breaking Good: Fracture Modes for
// Realtime Destruction" (TOG 2022). We work in 2D: each mode is the
// minimum-cost path across a seeded heterogeneous toughness grid
// (Dijkstra), with already-used paths cost-penalized so successive
// modes stay distinct. Strikes at runtime merely REVEAL these paths;
// the slab's fault lines exist before the first tap ever lands.

export interface ModePath {
  /** Fine polyline vertices in aspect-corrected UV space (x in [0, aspect], y in [0, 1]). */
  pts: { x: number; y: number }[];
  /** Short side-branches, each anchored at an index into pts. */
  branches: { anchor: number; pts: { x: number; y: number }[] }[];
}

// Deterministic PRNG so a slab's modes are reproducible from its seed
function mulberry32(seed: number) {
  let a = Math.floor(seed * 1e6) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Two-octave value noise over a random lattice
function makeToughness(rand: () => number, gw: number, gh: number): Float32Array {
  const LW = 13;
  const LH = 9;
  const lat1 = Float32Array.from({ length: LW * LH }, () => rand());
  const lat2 = Float32Array.from({ length: LW * 2 * LH * 2 }, () => rand());

  const sample = (lat: Float32Array, lw: number, lh: number, u: number, v: number) => {
    const x = u * (lw - 1);
    const y = v * (lh - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const x1 = Math.min(x0 + 1, lw - 1);
    const y1 = Math.min(y0 + 1, lh - 1);
    const a = lat[y0 * lw + x0] * (1 - fx) + lat[y0 * lw + x1] * fx;
    const b = lat[y1 * lw + x0] * (1 - fx) + lat[y1 * lw + x1] * fx;
    return a * (1 - fy) + b * fy;
  };

  const tough = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const u = x / (gw - 1);
      const v = y / (gh - 1);
      const n = 0.7 * sample(lat1, LW, LH, u, v) + 0.3 * sample(lat2, LW * 2, LH * 2, u, v);
      tough[y * gw + x] = 0.35 + 1.3 * n;
    }
  }
  return tough;
}

// Dijkstra over an 8-connected grid with a small binary heap
function cheapestPath(
  tough: Float32Array,
  gw: number,
  gh: number,
  start: number,
  isGoal: (node: number) => boolean,
): number[] {
  const dist = new Float32Array(gw * gh).fill(Infinity);
  const parent = new Int32Array(gw * gh).fill(-1);
  const heap: number[] = [start];
  const key = new Float32Array(gw * gh).fill(Infinity);
  dist[start] = 0;
  key[start] = 0;

  const up = (i: number) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (key[heap[p]] <= key[heap[i]]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const down = () => {
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && key[heap[l]] < key[heap[m]]) m = l;
      if (r < heap.length && key[heap[r]] < key[heap[m]]) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      i = m;
    }
  };

  const visited = new Uint8Array(gw * gh);
  while (heap.length > 0) {
    const node = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      down();
    }
    if (visited[node]) continue;
    visited[node] = 1;
    if (isGoal(node)) {
      const path: number[] = [];
      for (let n = node; n !== -1; n = parent[n]) path.push(n);
      return path.reverse();
    }
    const nx = node % gw;
    const ny = (node / gw) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const mx = nx + dx;
        const my = ny + dy;
        if (mx < 0 || mx >= gw || my < 0 || my >= gh) continue;
        const m = my * gw + mx;
        if (visited[m]) continue;
        const step = (dx !== 0 && dy !== 0 ? 1.41421356 : 1) * 0.5 * (tough[node] + tough[m]);
        const nd = dist[node] + step;
        if (nd < dist[m]) {
          dist[m] = nd;
          key[m] = nd;
          parent[m] = node;
          heap.push(m);
          up(heap.length - 1);
        }
      }
    }
  }
  return [];
}

export function computeFractureModes(seed: number, aspect: number, count: number): ModePath[] {
  const gh = 56;
  const gw = Math.max(24, Math.round(gh * aspect));
  const rand = mulberry32(seed);
  const tough = makeToughness(rand, gw, gh);

  const paths: ModePath[] = [];
  for (let k = 0; k < count; k++) {
    let nodes: number[];
    if (k % 2 === 0) {
      // left → right
      const y0 = 4 + Math.floor(rand() * (gh - 8));
      nodes = cheapestPath(tough, gw, gh, y0 * gw, (n) => n % gw === gw - 1);
    } else {
      // bottom → top
      const x0 = 4 + Math.floor(rand() * (gw - 8));
      nodes = cheapestPath(tough, gw, gh, x0, (n) => ((n / gw) | 0) === gh - 1);
    }
    if (nodes.length < 4) continue;

    // Penalize reuse so the next mode finds a different way across
    for (const n of nodes) {
      const nx = n % gw;
      const ny = (n / gw) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const mx = nx + dx;
          const my = ny + dy;
          if (mx < 0 || mx >= gw || my < 0 || my >= gh) continue;
          tough[my * gw + mx] *= 2.5;
        }
      }
    }

    // Every 2nd node keeps the natural wander without excess segments
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const n = nodes[i];
      pts.push({ x: ((n % gw) / (gw - 1)) * aspect, y: ((n / gw) | 0) / (gh - 1) });
    }
    const lastNode = nodes[nodes.length - 1];
    pts.push({ x: ((lastNode % gw) / (gw - 1)) * aspect, y: ((lastNode / gw) | 0) / (gh - 1) });

    // The Dijkstra path is the reference line; a Brownian-bridge midpoint
    // displacement around it gives the lightning-like crackle, and short
    // Brownian-walk offshoots give the branching. Both use the same
    // seeded PRNG, so re-striking a path restamps the identical geometry.
    const fine = midpointDisplace(pts, rand);
    paths.push({ pts: fine, branches: makeBranches(fine, rand) });
  }
  return paths;
}

export interface RegionMap {
  /** Piece id per cell, row-major, origin bottom-left (matches UV space). */
  ids: Uint8Array;
  gw: number;
  gh: number;
  count: number;
  /** Piece centroids in aspect-corrected UV space. */
  centroids: { x: number; y: number }[];
  /** Piece areas as fractions of the slab. */
  areas: number[];
}

// Partitions the slab into shatter pieces bounded by the REVEALED crack
// paths: the polylines are rasterized as walls on a fine grid, connected
// regions are flood-filled, and wall cells are then absorbed into the
// nearest region. The pieces the slab breaks into are exactly the areas
// its cracks enclose.
export function buildRegionMap(
  paths: ModePath[],
  revealed: boolean[],
  aspect: number,
  maxPieces: number,
): RegionMap {
  const gh = 116;
  const gw = Math.max(32, Math.round(gh * aspect));
  const WALL = 254;
  const UNSET = 255;
  const ids = new Uint8Array(gw * gh).fill(UNSET);

  for (let k = 0; k < paths.length; k++) {
    if (!revealed[k]) continue;
    const pts = paths[k].pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = (pts[i].x / aspect) * gw;
      const ay = pts[i].y * gh;
      const bx = (pts[i + 1].x / aspect) * gw;
      const by = pts[i + 1].y * gh;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = Math.min(gw - 1, Math.max(0, Math.floor(ax + (bx - ax) * t)));
        const cy = Math.min(gh - 1, Math.max(0, Math.floor(ay + (by - ay) * t)));
        ids[cy * gw + cx] = WALL;
      }
    }
  }

  // Flood-fill connected open regions (4-connectivity)
  const regionCells: number[][] = [];
  const queue = new Int32Array(gw * gh);
  for (let start = 0; start < gw * gh; start++) {
    if (ids[start] !== UNSET) continue;
    const id = regionCells.length;
    if (id >= 200) break; // can't happen with sane path counts
    const cells: number[] = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    ids[start] = id;
    while (head < tail) {
      const n = queue[head++];
      cells.push(n);
      const nx = n % gw;
      const ny = (n / gw) | 0;
      if (nx > 0 && ids[n - 1] === UNSET) { ids[n - 1] = id; queue[tail++] = n - 1; }
      if (nx < gw - 1 && ids[n + 1] === UNSET) { ids[n + 1] = id; queue[tail++] = n + 1; }
      if (ny > 0 && ids[n - gw] === UNSET) { ids[n - gw] = id; queue[tail++] = n - gw; }
      if (ny < gh - 1 && ids[n + gw] === UNSET) { ids[n + gw] = id; queue[tail++] = n + gw; }
    }
    regionCells.push(cells);
  }

  // Keep the largest maxPieces regions; everything else (small slivers,
  // wall cells) is absorbed into the nearest kept region by BFS
  const order = regionCells.map((cells, i) => ({ i, size: cells.length })).sort((a, b) => b.size - a.size);
  const remap = new Int32Array(regionCells.length).fill(-1);
  const kept = order.slice(0, maxPieces);
  kept.forEach((r, newId) => { remap[r.i] = newId; });

  let head = 0;
  let tail = 0;
  for (let n = 0; n < gw * gh; n++) {
    const v = ids[n];
    if (v !== WALL && remap[v] >= 0) {
      ids[n] = remap[v];
      queue[tail++] = n;
    } else {
      ids[n] = UNSET;
    }
  }
  while (head < tail) {
    const n = queue[head++];
    const id = ids[n];
    const nx = n % gw;
    const ny = (n / gw) | 0;
    if (nx > 0 && ids[n - 1] === UNSET) { ids[n - 1] = id; queue[tail++] = n - 1; }
    if (nx < gw - 1 && ids[n + 1] === UNSET) { ids[n + 1] = id; queue[tail++] = n + 1; }
    if (ny > 0 && ids[n - gw] === UNSET) { ids[n - gw] = id; queue[tail++] = n - gw; }
    if (ny < gh - 1 && ids[n + gw] === UNSET) { ids[n + gw] = id; queue[tail++] = n + gw; }
  }

  const count = kept.length;
  const centroids: { x: number; y: number }[] = [];
  const areas: number[] = [];
  const sums = new Float64Array(count * 3);
  for (let n = 0; n < gw * gh; n++) {
    const id = ids[n];
    if (id >= count) continue;
    sums[id * 3] += (n % gw) + 0.5;
    sums[id * 3 + 1] += ((n / gw) | 0) + 0.5;
    sums[id * 3 + 2]++;
  }
  for (let id = 0; id < count; id++) {
    const cnt = Math.max(sums[id * 3 + 2], 1);
    centroids.push({ x: (sums[id * 3] / cnt / gw) * aspect, y: sums[id * 3 + 1] / cnt / gh });
    areas.push(sums[id * 3 + 2] / (gw * gh));
  }
  return { ids, gw, gh, count, centroids, areas };
}

// Recursive midpoint displacement: each subdivision offsets the midpoint
// perpendicular to its segment by an amount proportional to the segment
// length, giving scale-invariant (Brownian) crackle around the base path
function midpointDisplace(pts: { x: number; y: number }[], rand: () => number) {
  const LEVELS = 2;
  const ROUGH = 0.5;
  let cur = pts;
  for (let level = 0; level < LEVELS; level++) {
    const next: { x: number; y: number }[] = [cur[0]];
    for (let i = 0; i + 1 < cur.length; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1e-6;
      const off = (rand() - 0.5) * len * ROUGH;
      next.push({ x: (a.x + b.x) / 2 + (-dy / len) * off, y: (a.y + b.y) / 2 + (dx / len) * off });
      next.push(b);
    }
    cur = next;
  }
  return cur;
}

// Short jittery offshoots leaving the main line at acute angles, like
// lightning leaders that didn't win
function makeBranches(fine: { x: number; y: number }[], rand: () => number) {
  const branches: { anchor: number; pts: { x: number; y: number }[] }[] = [];
  const STEP = 0.022; // branch step length, uv-height units
  for (let i = 4; i < fine.length - 4; i += 3 + Math.floor(rand() * 4)) {
    if (rand() > 0.55) continue;
    const dx = fine[i + 1].x - fine[i - 1].x;
    const dy = fine[i + 1].y - fine[i - 1].y;
    const base = Math.atan2(dy, dx);
    const side = rand() < 0.5 ? 1 : -1;
    let ang = base + side * (0.5 + rand() * 0.7);
    let x = fine[i].x;
    let y = fine[i].y;
    const pts = [{ x, y }];
    const steps = 2 + Math.floor(rand() * 4);
    for (let s = 0; s < steps; s++) {
      ang += (rand() - 0.5) * 0.9;
      x += Math.cos(ang) * STEP * (0.7 + rand() * 0.6);
      y += Math.sin(ang) * STEP * (0.7 + rand() * 0.6);
      pts.push({ x, y });
    }
    branches.push({ anchor: i, pts });
  }
  return branches;
}
