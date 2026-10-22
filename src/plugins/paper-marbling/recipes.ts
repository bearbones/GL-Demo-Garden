// ── Palettes and classic patterns ───────────────────────────────────
// Recipes are timelines of drops and tool passes in bath units (the bath
// spans x ∈ [−aspect/2, aspect/2], y ∈ [−0.5, 0.5]). The plugin plays them
// back through the same op machinery as user input, so every pass is
// visible as a comb or stylus moving through the paint.

export type Vec2 = [number, number];
export type RGB = [number, number, number];

export interface Palette {
  label: string;
  colors: RGB[];
  /** Suminagashi: taps alternate ink with clear surfactant drops */
  alternateClear?: boolean;
  /** Coverage of each drop; sumi ink is a slightly translucent film */
  inkAlpha?: number;
}

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// The last colour of each multi-colour palette is the light ground
export const PALETTES: Record<string, Palette> = {
  ottoman: {
    label: 'Ottoman',
    colors: [hex('#a63a2c'), hex('#26406e'), hex('#d6a23d'), hex('#56703f'), hex('#efe6d1')],
  },
  victorian: {
    label: 'Victorian',
    colors: [hex('#1d3866'), hex('#b0382a'), hex('#d0a24a'), hex('#25232a'), hex('#7d8fa3')],
  },
  indigo: {
    label: 'Indigo',
    colors: [hex('#19284a'), hex('#2e5088'), hex('#7395c4'), hex('#cad7e8'), hex('#f1ede3')],
  },
  coral: {
    label: 'Coral & Teal',
    colors: [hex('#e06a55'), hex('#24797a'), hex('#e8b440'), hex('#1f2e4e'), hex('#f3c9b5')],
  },
  sumi: {
    label: 'Suminagashi',
    colors: [hex('#1b1b1f'), hex('#2a3a5e')],
    alternateClear: true,
    inkAlpha: 0.85,
  },
};

/** One tool: a stylus is a comb with one tine */
export interface StrokeTool {
  tines: number;
  spacing: number;  // between tines, bath units
  size: number;     // rod size, bath units
  kappa: number;    // fraction of rod speed the paint at the rod moves
  axis: Vec2;       // unit vector the tines are spread along
  falloff: number;  // cross-path wake width, bath units; 0 = derive from size
}

export interface DropSpec {
  at: number;      // seconds into the recipe
  x: number;
  y: number;
  r: number;
  color: number;   // palette index; −1 = clear drop (bare size), −2 = random
  spread?: number; // seconds to reach full size (default scales with r)
  spot?: number;   // drops sharing a spot land on its current centre
}

/** A breath on the water: the paint turns about a centre, less with distance */
export interface SwirlSpec {
  at: number;
  x: number;
  y: number;
  radius: number; // falloff radius, bath units
  angle: number;  // turn at the centre, radians (sign = direction)
  dur: number;    // seconds to turn fully
}

export interface StrokeSpec {
  start: number;
  dur: number;
  path: (u: number) => Vec2;
  tool: StrokeTool;
}

export interface Recipe {
  drops: DropSpec[];
  strokes: StrokeSpec[];
  swirls: SwirlSpec[];
  end: number;
}

export const RECIPES: { id: string; label: string }[] = [
  { id: 'bullseye', label: 'Bullseyes' },
  { id: 'stone', label: 'Stone' },
  { id: 'gelgel', label: 'Gel-gel' },
  { id: 'chevron', label: 'Chevron' },
  { id: 'nonpareil', label: 'Nonpareil' },
  { id: 'bouquet', label: 'Bouquet' },
  { id: 'suminagashi', label: 'Suminagashi' },
];

const ROD = 0.0045;
const PASS = 1.6; // seconds per full comb pass

/** Sprinkle rounds of one colour each over the whole bath, cell by cell */
function sprinkle(
  out: DropSpec[], rnd: () => number, aspect: number, t0: number,
  rounds: { color: number; cell: number; prob?: number }[], roundDur: number,
): number {
  rounds.forEach((round, k) => {
    const g = round.cell;
    const x0 = -aspect / 2 - g * 0.5;
    const y0 = -0.5 - g * 0.5;
    const nx = Math.ceil((aspect + g) / g);
    const ny = Math.ceil((1 + g) / g);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        if (rnd() > (round.prob ?? 1)) continue;
        out.push({
          at: t0 + k * roundDur + rnd() * roundDur * 0.9,
          x: x0 + (i + 0.5 + (rnd() - 0.5) * 0.9) * g,
          y: y0 + (j + 0.5 + (rnd() - 0.5) * 0.9) * g,
          r: g * 0.5 * (0.8 + 0.4 * rnd()),
          color: round.color,
        });
      }
    }
  });
  return t0 + rounds.length * roundDur;
}

/** One huge drop of the ground colour, so no bare size survives the sprinkle */
function ground(out: DropSpec[], aspect: number, color: number) {
  out.push({ at: 0, x: 0, y: 0, r: Math.hypot(aspect / 2, 0.5) + 0.2, color, spread: 0.7 });
}

/**
 * Drops sharing a spot should stay concentric, but drops landing elsewhere
 * push each spot's rings sideways. Follow every spot's centre through each
 * drop's forward map p' = c + (p−c)·√(1 + R²/|p−c|²) and land each drop on
 * its spot's current centre.
 */
function trackSpots(drops: DropSpec[]) {
  const centres = new Map<number, Vec2>();
  for (const d of drops) {
    if (d.spot === undefined) continue;
    const c = centres.get(d.spot);
    if (c) {
      d.x = c[0];
      d.y = c[1];
    } else {
      centres.set(d.spot, [d.x, d.y]);
    }
    for (const p of centres.values()) {
      const dx = p[0] - d.x;
      const dy = p[1] - d.y;
      const r2 = dx * dx + dy * dy;
      if (r2 < 1e-12) continue;
      const f = Math.sqrt(1 + (d.r * d.r) / r2);
      p[0] = d.x + dx * f;
      p[1] = d.y + dy * f;
    }
  }
}

/** A rake; its wake widens with the tine spacing so wide combs draw flames */
function comb(spacing: number, axis: Vec2, span: number, kappa = 0.9): StrokeTool {
  return { tines: Math.ceil(span / spacing) + 1, spacing, size: ROD, kappa, axis, falloff: 0.25 * spacing };
}

/** Straight full-bath pass of a comb, entering and leaving off-screen */
function pass(start: number, from: Vec2, to: Vec2, tool: StrokeTool): StrokeSpec {
  return {
    start, dur: PASS, tool,
    path: (u) => [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u],
  };
}

export function buildRecipe(id: string, aspect: number, nColors: number, rnd: () => number): Recipe {
  const drops: DropSpec[] = [];
  const strokes: StrokeSpec[] = [];
  const swirls: SwirlSpec[] = [];
  const c = (i: number) => i % nColors;
  const light = nColors - 1;
  // Passes reach past the edges of the bath in either orientation, so a
  // phone rotated mid-pattern still sees whole passes
  const halfW = Math.max(aspect, 1 / aspect) / 2 + 0.15;
  const vComb = (s: number, kappa?: number) => comb(s, [1, 0], 2 * halfW + 0.3, kappa); // moves vertically
  const hComb = (s: number, kappa?: number) => comb(s, [0, 1], 1.6, kappa);             // moves horizontally
  let t = 0;

  // Gel-gel: a light ground, three colours sprinkled over it, then a wide
  // rake down the bath and back up between the first strokes
  const gelgel = () => {
    ground(drops, aspect, light);
    t = sprinkle(drops, rnd, aspect, 0.5, [
      { color: c(0), cell: 0.23 }, { color: c(1), cell: 0.2 }, { color: c(2), cell: 0.17 },
    ], 0.75) + 0.6;
    strokes.push(pass(t, [0, 0.66], [0, -0.66], vComb(0.14)));
    t += PASS + 0.3;
    strokes.push(pass(t, [0.07, -0.66], [0.07, 0.66], vComb(0.14)));
    t += PASS + 0.3;
  };

  switch (id) {
    case 'bullseye': {
      // Target rings: drops of alternating colour landing on the same spots
      // Keep targets about a quarter bath apart so they don't press flat
      const cols = Math.max(2, Math.round(aspect * 2.4));
      const rows = aspect < 0.6 ? 4 : 3;
      const ringColours = Math.max(1, nColors > 3 ? nColors - 1 : nColors); // keep the light ground out
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = ((i + 0.5 + (j % 2) * 0.5) / cols - 0.5) * aspect;
          const y = (j + 0.5) / rows - 0.5;
          for (let k = 0; k < 5; k++) {
            drops.push({
              at: k * 0.32 + rnd() * 0.12, x, y, r: 0.05 - k * 0.004,
              color: (k + i + j) % ringColours, spot: i * rows + j,
            });
          }
        }
      }
      t = 2.0;
      break;
    }
    case 'stone': {
      ground(drops, aspect, light);
      t = sprinkle(drops, rnd, aspect, 0.5, [
        { color: c(0), cell: 0.24 }, { color: c(1), cell: 0.2 },
        { color: c(2), cell: 0.17 }, { color: c(3), cell: 0.15, prob: 0.85 },
      ], 0.9);
      break;
    }
    case 'gelgel':
      gelgel();
      break;
    case 'chevron':
      gelgel();
      strokes.push(pass(t, [-halfW, 0], [halfW, 0], hComb(0.11)));
      t += PASS + 0.3;
      strokes.push(pass(t, [halfW, 0.055], [-halfW, 0.055], hComb(0.11)));
      t += PASS;
      break;
    case 'nonpareil':
      gelgel();
      strokes.push(pass(t, [-halfW, 0], [halfW, 0], hComb(0.026, 0.7)));
      t += PASS;
      break;
    case 'bouquet': {
      gelgel();
      strokes.push(pass(t, [-halfW, 0], [halfW, 0], hComb(0.026, 0.7)));
      t += PASS + 0.3;
      // A wide comb drawn down the bath in a sinuous line
      const tool = vComb(0.12);
      strokes.push({
        start: t, dur: PASS * 1.4, tool,
        path: (u) => [0.045 * Math.sin(u * Math.PI * 2 * 3.5), 0.66 - 1.32 * u],
      });
      t += PASS * 1.4;
      break;
    }
    case 'suminagashi': {
      // Ink and clear drops alternate from brushes held at fixed points; each
      // new drop pushes the older rings out, so they thin toward the outside
      // and neighbouring families press one another off-centre. Drop sizes
      // vary, as they do from a brush, so the rings vary in width.
      const cols = Math.max(2, Math.round(aspect * 1.8));
      const rows = aspect < 0.8 ? 3 : 2;
      const n = 70;
      let spot = 0;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = ((i + 0.5 + (j % 2 ? 0.35 : -0.15)) / cols - 0.5) * aspect + (rnd() - 0.5) * 0.08;
          const y = ((j + 0.5) / rows - 0.5) * 0.9 + (rnd() - 0.5) * 0.08;
          const ink = c(spot);
          const offset = rnd() * 0.05;
          for (let k = 0; k < n; k++) {
            const clear = k % 2 === 1;
            const r = 0.042 * (clear ? 0.8 + 0.8 * rnd() : 0.5 + 0.5 * rnd());
            drops.push({ at: offset + k * 0.05, x, y, r, color: clear ? -1 : ink });
          }
          spot++;
        }
      }
      t = n * 0.05 + 0.5;
      // Then breathe on the water: overlapping slow turns, alternating in
      // direction, bend the rings into soft contours like wood grain
      const breaths = 7;
      for (let k = 0; k < breaths; k++) {
        swirls.push({
          at: t + k * 0.55,
          x: (rnd() - 0.5) * aspect * 0.9,
          y: (rnd() - 0.5) * 0.8,
          radius: 0.16 + 0.14 * rnd(),
          angle: (k % 2 ? -1 : 1) * (0.6 + 0.6 * rnd()),
          dur: 1.6,
        });
      }
      t += breaths * 0.55 + 1.6;
      break;
    }
  }

  drops.sort((a, b) => a.at - b.at);
  trackSpots(drops);
  return { drops, strokes, swirls, end: t };
}
