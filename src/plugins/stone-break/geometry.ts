export interface Point { x: number; y: number }
export interface Seam { a: number; b: number; points: Point[]; length: number; owners: number[] }
export interface Fragment { boundary: Point[]; triangles: number[]; center: Point; area: number; edges: { id: number; forward: boolean }[] }
export interface Slab { outline: Point[]; junctions: Point[]; seams: Seam[]; fragments: Fragment[]; seed: number }
export const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export function area(p: Point[]): number { return p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]; return sum + a.x * b.y - a.y * b.x; }, 0) * 0.5; }
export function randomSource(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return { distance: distance(p, lerp(a, b, t)), t };
}
export function contains(polygon: Point[], p: Point) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function clip(polygon: Point[], nx: number, ny: number, c: number) {
  const result: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = a.x * nx + a.y * ny - c, db = b.x * nx + b.y * ny - c;
    if (da <= 1e-10) result.push(a);
    if ((da < 0) !== (db < 0)) result.push(lerp(a, b, da / (da - db)));
  }
  return result.filter((p, i) => distance(p, result[(i + result.length - 1) % result.length]) > 1e-7);
}
export function triangulate(polygon: Point[]) {
  const remaining = polygon.map((_, i) => i), result: number[] = [];
  while (remaining.length > 3) {
    let found = false;
    for (let j = 0; j < remaining.length; j++) {
      const ia = remaining[(j + remaining.length - 1) % remaining.length], ib = remaining[j], ic = remaining[(j + 1) % remaining.length];
      const a = polygon[ia], b = polygon[ib], c = polygon[ic];
      if (cross(a, b, c) <= 1e-11) continue;
      if (remaining.some(k => k !== ia && k !== ib && k !== ic && cross(a, b, polygon[k]) >= -1e-10 && cross(b, c, polygon[k]) >= -1e-10 && cross(c, a, polygon[k]) >= -1e-10)) continue;
      result.push(ia, ib, ic); remaining.splice(j, 1); found = true; break;
    }
    if (!found) throw new Error('Invalid stone polygon: triangulation failed');
  }
  result.push(...remaining);
  return result;
}
export function makeSlab(width: number, height: number, count: number, roughness: number, seed: number): Slab {
  const random = randomSource(seed), w = width / 2, h = height / 2;
  const c = Math.min(w, h) * 0.18;
  const outline: Point[] = [
    { x: -w + c * 1.2, y: -h }, { x: w - c * 1.7, y: -h * 0.97 },
    { x: w, y: -h + c * 1.1 }, { x: w * 0.98, y: h - c * 1.4 },
    { x: w - c, y: h }, { x: -w + c * 1.5, y: h * 0.96 },
    { x: -w, y: h - c }, { x: -w * 0.99, y: -h + c * 1.5 },
  ];
  // Best-candidate spacing produces coarse pieces without a visible seed grid.
  const sites: Point[] = [];
  for (let i = 0; i < count; i++) {
    let best = { x: 0, y: 0 }, score = -1;
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = { x: (random() * 2 - 1) * w * 0.86, y: (random() * 2 - 1) * h * 0.84 };
      if (!contains(outline, candidate)) continue;
      const separation = sites.length ? Math.min(...sites.map(p => distance(p, candidate))) : 1;
      if (separation > score) { best = candidate; score = separation; }
    }
    sites.push(best);
  }
  const polygons = sites.map((p, i) => {
    let polygon = outline.slice();
    for (let j = 0; j < sites.length; j++) if (i !== j) {
      const q = sites[j];
      polygon = clip(polygon, q.x - p.x, q.y - p.y, (q.x * q.x + q.y * q.y - p.x * p.x - p.y * p.y) / 2);
    }
    return polygon;
  });
  const junctions: Point[] = [], vertexMap = new Map<string, number>();
  const vertex = (p: Point) => {
    const key = `${Math.round(p.x * 1e7)},${Math.round(p.y * 1e7)}`;
    let id = vertexMap.get(key);
    if (id === undefined) { id = junctions.length; junctions.push({ x: Math.round(p.x * 1e7) / 1e7, y: Math.round(p.y * 1e7) / 1e7 }); vertexMap.set(key, id); }
    return id;
  };
  const seams: Seam[] = [], edgeMap = new Map<string, number>();
  const fragmentEdges = polygons.map((polygon, owner) => polygon.map((p, i) => {
    const from = vertex(p), to = vertex(polygon[(i + 1) % polygon.length]);
    const a = Math.min(from, to), b = Math.max(from, to), key = `${a}:${b}`;
    let id = edgeMap.get(key);
    if (id === undefined) { id = seams.length; seams.push({ a, b, points: [], length: 0, owners: [] }); edgeMap.set(key, id); }
    seams[id].owners.push(owner);
    return { id, forward: from === a };
  }));
  for (const seam of seams) {
    const a = junctions[seam.a], b = junctions[seam.b], length = distance(a, b);
    const steps = seam.owners.length === 2 ? Math.max(2, Math.ceil(length / 0.13)) : 1;
    seam.points.push(a);
    for (let j = 1; j < steps; j++) {
      const p = lerp(a, b, j / steps);
      const clearance = Math.min(...seams.filter(other => other !== seam).map(other => segmentDistance(p, junctions[other.a], junctions[other.b]).distance));
      const amplitude = Math.min(length * 0.12, clearance * 0.22, 0.045) * roughness;
      const offset = (random() * 2 - 1) * amplitude;
      seam.points.push({ x: p.x - (b.y - a.y) / length * offset, y: p.y + (b.x - a.x) / length * offset });
    }
    seam.points.push(b);
    seam.length = seam.points.slice(1).reduce((sum, p, i) => sum + distance(seam.points[i], p), 0);
  }
  const fragments = fragmentEdges.map((edges, i) => {
    // These are the same Point objects used by the seam renderer, not a
    // separately sampled edge or a texture-derived membership boundary.
    const boundary = edges.flatMap(({ id, forward }) => {
      const points = seams[id].points;
      return (forward ? points : points.slice().reverse()).slice(0, -1);
    });
    return { boundary, triangles: triangulate(boundary), center: sites[i], area: area(boundary), edges };
  });
  return { outline, junctions, seams, fragments, seed };
}

/** Shortest distance along the same seam network that bounds the fragments. */
export function strikeDistances(slab: Slab, point: Point): number[][] {
  let hit = -1, hitAt = 0, nearest = Infinity;
  slab.seams.forEach((edge, id) => {
    if (edge.owners.length !== 2) return;
    let along = 0;
    for (let j = 1; j < edge.points.length; j++) {
      const length = distance(edge.points[j - 1], edge.points[j]);
      const projection = segmentDistance(point, edge.points[j - 1], edge.points[j]);
      if (projection.distance < nearest) { nearest = projection.distance; hit = id; hitAt = along + projection.t * length; }
      along += length;
    }
  });
  const distances = slab.junctions.map(() => Infinity), visited = new Set<number>();
  const edge = slab.seams[hit];
  distances[edge.a] = hitAt; distances[edge.b] = edge.length - hitAt;
  for (let i = 0; i < distances.length; i++) {
    let node = -1;
    distances.forEach((d, id) => { if (!visited.has(id) && (node < 0 || d < distances[node])) node = id; });
    if (node < 0 || !Number.isFinite(distances[node])) break;
    visited.add(node);
    for (const seam of slab.seams) if (seam.owners.length === 2) {
      if (seam.a === node) distances[seam.b] = Math.min(distances[seam.b], distances[node] + seam.length);
      if (seam.b === node) distances[seam.a] = Math.min(distances[seam.a], distances[node] + seam.length);
    }
  }
  return slab.seams.map((seam, id) => {
    let along = 0;
    return seam.points.map((p, j) => {
      if (j) along += distance(seam.points[j - 1], p);
      return seam.owners.length === 2 ? Math.min(distances[seam.a] + along, distances[seam.b] + seam.length - along, id === hit ? Math.abs(along - hitAt) : Infinity) : Infinity;
    });
  });
}
