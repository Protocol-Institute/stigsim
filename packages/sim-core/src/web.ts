/**
 * Webs as data: a construction plan a spider could have followed, held in
 * normalised coordinates so it is independent of the grid it is later drawn
 * into.
 *
 * Nothing here knows about cells, ants, or the engine. `web-transpile.ts`
 * lowers a plan onto a grid; this file only decides where the silk goes.
 *
 * No trigonometry appears anywhere in this module, and that is load-bearing
 * rather than stylistic. ECMAScript leaves the precision of `Math.sin`,
 * `Math.cos` and `Math.atan2` implementation-defined, exactly as it does
 * `Math.pow` — which is why `deterministicPow` exists. A web placed by angle
 * would be a different web in Safari than in Chrome, and because the maze is
 * part of the run, the same seed would give a different run. Everything below
 * is built from addition, multiplication, division and square root, all of
 * which IEEE-754 specifies exactly.
 *
 * That constraint turns out to describe the animal too. A spider does not
 * compute where to attach: it walks out along a radius and fastens where it
 * arrives. Building the spiral by walking the radii in order is both the
 * deterministic implementation and the faithful one.
 */
import type { Rng } from "./rng";

/** A point in the unit square. Scaled to cells by the transpiler. */
export interface Point { x: number; y: number }

export type StrandKind = "bridge" | "frame" | "radius" | "auxiliary" | "capture";

/** How a strand spans the gap. Dangling and swinging bend it; a taut line does not. */
export type Span = "taut" | "sag" | "arc";

export interface Strand {
  kind: StrandKind;
  /**
   * Must already lie on the web. The bridge is the base case, and this is what
   * makes a plan connected by construction rather than by later inspection.
   */
  from: Point;
  to: Point;
  span: Span;
  /**
   * Set by the strategy, never implied by `kind`. The orb-weaver leaves its
   * radii dry and its capture spiral sticky, but that is one strategy's
   * choice: a sticky radius is a legal web.
   */
  sticky: boolean;
  /** Construction order, so a build can be replayed or animated. */
  step: number;
}

export interface WebPlan {
  anchors: readonly Point[];
  hub: Point;
  strands: readonly Strand[];
}

export interface WebOptions {
  /** Radii the strategy aims for. The transpiler may merge them near the hub. */
  radii?: number;
  /** Turns of capture spiral between hub and frame. */
  turns?: number;
  /**
   * Fraction of the auxiliary spiral left in place, in [0, 1].
   *
   * The auxiliary spiral is scaffolding a real spider eats as it lays the
   * capture spiral. Retaining some of it leaves connections beyond the
   * minimum, which is what `loopRate` already means elsewhere: 0 is a finished
   * web, higher is one caught mid-construction.
   */
  loopRate?: number;
}

export type WebStrategy = (rng: Rng, anchors: readonly Point[], options?: WebOptions) => WebPlan;

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

const dist = (a: Point, b: Point): number => Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);

/**
 * A value that increases monotonically with the true angle, computed without
 * trigonometry. Enough to sort points around a centre, which is all the
 * ordering below needs.
 *
 * The result is in [0, 4) and is not an angle in radians; only its order is
 * meaningful.
 */
export function pseudoAngle(dx: number, dy: number): number {
  const d = Math.abs(dx) + Math.abs(dy);
  if (d === 0) return 0;
  const p = dx / d;
  return dy < 0 ? 3 + p : 1 - p;
}

/** Anchors in cyclic order around a centre, so the frame is a simple polygon. */
export function orderAround(points: readonly Point[], centre: Point): Point[] {
  return [...points].sort(
    (a, b) => pseudoAngle(a.x - centre.x, a.y - centre.y) - pseudoAngle(b.x - centre.x, b.y - centre.y),
  );
}

const centroid = (points: readonly Point[]): Point => ({
  x: points.reduce((s, p) => s + p.x, 0) / points.length,
  y: points.reduce((s, p) => s + p.y, 0) / points.length,
});

/**
 * The point at `t` of the way around a closed polygon, by arc length.
 *
 * Radii land on the frame through this rather than by choosing an angle, which
 * is what keeps the construction trig-free. It is also how a spider picks the
 * spot: by travelling along the frame until it has gone far enough.
 */
export function alongPerimeter(poly: readonly Point[], t: number): Point {
  const n = poly.length;
  const lengths = poly.map((p, i) => dist(p, poly[(i + 1) % n]));
  const total = lengths.reduce((s, l) => s + l, 0);
  if (total === 0) return poly[0];

  // t wraps, so a radius index past the end continues round the frame.
  let target = (t - Math.floor(t)) * total;
  for (let i = 0; i < n; i++) {
    if (target <= lengths[i]) {
      return lerp(poly[i], poly[(i + 1) % n], lengths[i] === 0 ? 0 : target / lengths[i]);
    }
    target -= lengths[i];
  }
  return poly[0];
}

/** A jitter of +/- `amount`, spending one draw. */
const wobble = (rng: Rng, amount: number): number => (rng() * 2 - 1) * amount;

/**
 * The orb-weaver: bridge, drop to a hub, frame, radii, then spirals.
 *
 * Preset #1, not the architecture. It is here because it is a known-good
 * sequence that produces something recognisable, and because its dry-radii /
 * sticky-spiral split is a ready-made asymmetry: the radii are fast safe
 * travel and the spiral is slow dangerous travel.
 */
export const orbWeaver: WebStrategy = (rng, anchors, options = {}) => {
  const radii = Math.max(3, options.radii ?? 8);
  const turns = Math.max(1, options.turns ?? 4);
  const loopRate = Math.min(1, Math.max(0, options.loopRate ?? 0));

  if (anchors.length < 3) throw new RangeError("a web needs at least three anchors");

  const centre = centroid(anchors);
  const frame = orderAround(anchors, centre);
  const strands: Strand[] = [];
  let step = 0;

  // 1. The bridge. Two anchors, and the base case for connectivity: it is the
  //    only strand whose `from` is not already on the web.
  const bridge: Strand = {
    kind: "bridge", from: frame[0], to: frame[1], span: "taut", sticky: false, step: step++,
  };
  strands.push(bridge);

  // 2. The drop. The spider dangles from the bridge and the junction becomes
  //    the hub, so the hub is off-centre by however the bridge happened to
  //    fall rather than by construction.
  const drop = lerp(bridge.from, bridge.to, 0.5 + wobble(rng, 0.12));
  const hub = lerp(drop, centre, 0.75 + wobble(rng, 0.15));
  strands.push({ kind: "bridge", from: drop, to: hub, span: "sag", sticky: false, step: step++ });

  // 3. The frame, closing the polygon through the remaining anchors.
  for (let i = 1; i < frame.length; i++) {
    strands.push({
      kind: "frame", from: frame[i], to: frame[(i + 1) % frame.length],
      span: "taut", sticky: false, step: step++,
    });
  }

  // 4. Radii, hub outward. Ends are spaced by arc length around the frame,
  //    with a wobble so the web is not a wheel.
  const ends: Point[] = [];
  for (let i = 0; i < radii; i++) {
    const t = i / radii + wobble(rng, 0.35 / radii);
    const end = alongPerimeter(frame, t);
    ends.push(end);
    strands.push({ kind: "radius", from: hub, to: end, span: "taut", sticky: false, step: step++ });
  }

  // 5 and 6. The spirals. Both walk radius to radius, attaching where they
  //    arrive; neither knows an angle. The auxiliary is dry scaffolding kept
  //    only at `loopRate`; the capture spiral is the trap.
  const ring = (frac: number, kind: StrandKind, sticky: boolean) => {
    for (let i = 0; i < radii; i++) {
      const a = lerp(hub, ends[i], frac);
      const b = lerp(hub, ends[(i + 1) % radii], frac + (1 / radii) * 0.15);
      strands.push({ kind, from: a, to: b, span: "arc", sticky, step: step++ });
    }
  };

  for (let k = 1; k <= turns; k++) {
    const frac = k / (turns + 1);
    // The auxiliary spiral sits between capture turns, which is where a
    // spider's scaffolding runs before it is eaten.
    if (k < turns && rng() < loopRate) ring(frac + 0.5 / (turns + 1), "auxiliary", false);
    ring(frac, "capture", true);
  }

  return { anchors: frame, hub, strands };
};

/** Build a plan. The strategy is data, so a second one is a preset rather than a rewrite. */
export function buildWeb(
  rng: Rng, anchors: readonly Point[], options: WebOptions = {}, strategy: WebStrategy = orbWeaver,
): WebPlan {
  return strategy(rng, anchors, options);
}
