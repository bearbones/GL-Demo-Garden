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
}

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

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
  },
};

/** One tool: a stylus is a comb with one tine */
export interface StrokeTool {
  tines: number;
  spacing: number; // between tines, bath units
  size: number;    // rod size, bath units
  kappa: number;   // fraction of rod speed the paint at the rod moves
  axis: Vec2;      // unit vector the tines are spread along
}

export interface DropSpec {
  at: number;    // seconds into the recipe
  x: number;
  y: number;
  r: number;
  color: number; // palette index; −1 = clear drop (bare size)
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

function comb(spacing: number, axis: Vec2, span: number): StrokeTool {
  return { tines: Math.ceil(span / spacing) + 1, spacing, size: ROD, kappa: 0.9, axis };
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
  const c = (i: number) => i % nColors;
  const halfW = aspect / 2 + 0.15;
  const vComb = (s: number) => comb(s, [1, 0], aspect + 0.6); // tines across, moves vertically
  const hComb = (s: number) => comb(s, [0, 1], 1.6);          // tines down, moves horizontally
  let t = 0;

  // Gel-gel ground: three colours sprinkled to full cover, then a wide
  // rake down the bath and back up between the first strokes
  const gelgel = () => {
    t = sprinkle(drops, rnd, aspect, 0, [
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
      const cols = Math.max(3, Math.round(aspect * 2.4));
      const rows = 3;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = ((i + 0.5 + (j % 2) * 0.5) / cols - 0.5) * aspect;
          const y = (j + 0.5) / rows - 0.5;
          for (let k = 0; k < 5; k++) {
            drops.push({ at: k * 0.32 + rnd() * 0.12, x, y, r: 0.05 - k * 0.004, color: c(k + i + j) });
          }
        }
      }
      t = 2.0;
      break;
    }
    case 'stone': {
      t = sprinkle(drops, rnd, aspect, 0, [
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
      strokes.push(pass(t, [-halfW, 0], [halfW, 0], hComb(0.026)));
      t += PASS;
      break;
    case 'bouquet': {
      gelgel();
      strokes.push(pass(t, [-halfW, 0], [halfW, 0], hComb(0.026)));
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
      // Ink and clear drops alternate on a few spots: concentric rings
      const spots: Vec2[] = [];
      for (let i = 0; i < 4; i++) {
        spots.push([(i - 1.5) / 4 * aspect * 0.9 + (rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.45]);
      }
      for (let k = 0; k < 14; k++) {
        spots.forEach(([x, y], s) => {
          drops.push({ at: k * 0.16 + s * 0.04, x, y, r: 0.034, color: k % 2 ? -1 : c(s % 2) });
        });
      }
      t = 14 * 0.16 + 0.8;
      // Then a gentle breath across the water: broad, soft stylus curves
      const soft: StrokeTool = { tines: 1, spacing: 0, size: 0.011, kappa: 0.72, axis: [0, 1] };
      strokes.push({
        start: t, dur: 2.4, tool: soft,
        path: (u) => [-halfW + 2 * halfW * u, 0.12 * Math.sin(u * Math.PI * 2.2) - 0.05],
      });
      t += 2.6;
      strokes.push({
        start: t, dur: 2.0, tool: soft,
        path: (u) => [0.2 * Math.sin(u * Math.PI * 1.6) + 0.1, 0.62 - 1.24 * u],
      });
      t += 2.0;
      break;
    }
  }

  drops.sort((a, b) => a.at - b.at);
  return { drops, strokes, end: t };
}
