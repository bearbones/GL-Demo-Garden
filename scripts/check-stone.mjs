// node scripts/check-stone.mjs — no browser or dev server required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/plugins/stone-break/geometry.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
const { makeSlab, area, contains, cross, strikeDistances } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
let cases = 0, fragments = 0, minimumAreaFraction = 1, sampleCount = 0;
const intersects = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < -1e-16 && cross(c, d, a) * cross(c, d, b) < -1e-16;
for (const aspect of [0.48, 0.75, 1, 1.5, 2.4]) {
  const width = Math.min(2.15, aspect * 1.48), height = Math.min(1.3, width / 1.35);
  for (const count of [10, 14, 18]) for (const roughness of [0.2, 1]) for (let seed = 1; seed <= 24; seed++) {
    const slab = makeSlab(width, height, count, roughness, seed * 7919), total = area(slab.outline);
    const sum = slab.fragments.reduce((s, p) => s + area(p.boundary), 0);
    assert.ok(Math.abs(sum - total) < 2e-6, `Slab coverage drift, seed ${seed}`);
    assert.equal(slab.fragments.length, count);
    for (const [owner, piece] of slab.fragments.entries()) {
      const polygon = piece.boundary;
      const fraction = area(polygon) / total;
      minimumAreaFraction = Math.min(minimumAreaFraction, fraction);
      assert.ok(fraction > 0.014, `Micro-fragment: seed ${seed}, area ${fraction}`);
      assert.ok(contains(polygon, piece.center), 'Site left its fragment');
      let trianglesArea = 0;
      for (let i = 0; i < piece.triangles.length; i += 3) {
        const [a, b, c] = piece.triangles.slice(i, i + 3).map(k => polygon[k]);
        const triangleArea = cross(a, b, c) / 2;
        assert.ok(triangleArea > 1e-12, 'Inverted or degenerate triangle');
        trianglesArea += triangleArea;
      }
      assert.ok(Math.abs(trianglesArea - area(polygon)) < 1e-8, 'Triangulation does not cover polygon');
      for (let a = 0; a < polygon.length; a++) for (let b = a + 2; b < polygon.length; b++) {
        if (a === 0 && b === polygon.length - 1) continue;
        assert.ok(!intersects(polygon[a], polygon[(a + 1) % polygon.length], polygon[b], polygon[(b + 1) % polygon.length]), 'Self-intersecting fragment');
      }
      // Shared polyline vertices must literally be fragment boundary vertices.
      for (const edge of piece.edges) {
        const seam = slab.seams[edge.id];
        assert.ok(seam.owners.includes(owner));
        for (const point of seam.points) assert.ok(polygon.includes(point), 'Crack and fragment edge are different geometry');
      }
      fragments++;
    }
    for (const seam of slab.seams) {
      assert.ok(seam.owners.length === 1 || seam.owners.length === 2, 'Non-manifold edge');
      if (seam.owners.length === 2) {
        const directions = seam.owners.map(owner => slab.fragments[owner].edges.find(edge => slab.seams[edge.id] === seam).forward);
        assert.notEqual(...directions, 'Adjacent fragments must traverse shared seam in opposite directions');
      }
    }
    const segments = slab.seams.flatMap(seam => seam.points.slice(1).map((b, i) => [seam.points[i], b]));
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      assert.ok(!intersects(...segments[i], ...segments[j]), 'Crossing seam network');
    }
    const distances = strikeDistances(slab, { x: 0.02, y: 0.01 });
    for (const [id, seam] of slab.seams.entries()) if (seam.owners.length === 2) {
      assert.ok(distances[id].every(Number.isFinite), 'Disconnected crack graph cannot complete the fracture');
    }
    // Independent point-membership coverage catches overlap balanced by gaps.
    for (let x = 0; x < 21; x++) for (let y = 0; y < 15; y++) {
      const p = { x: (x / 20 - 0.5) * width * 1.07 + 0.000013, y: (y / 14 - 0.5) * height * 1.07 + 0.000019 };
      const membership = slab.fragments.filter(piece => contains(piece.boundary, p)).length;
      assert.equal(membership, contains(slab.outline, p) ? 1 : 0, `Overlap/gap: seed ${seed}, aspect ${aspect}`);
      sampleCount++;
    }
    cases++;
  }
}
console.log(JSON.stringify({ cases, fragments, sampleCount, minimumAreaFraction, coverage: 'exactly one owner inside, zero outside', sharedSeams: 'same point objects, opposite traversal', crackGraph: 'connected' }, null, 2));
