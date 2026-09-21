/**
 * Render spider-web mazes to PNG and to the terminal, so a web can be looked
 * at rather than only asserted about.
 *
 * The open question about this layout is not whether it is correct — tests
 * answer that — but whether a web at 31x31 is playable or a miserable
 * bottleneck. Only looking tells you. Run with:
 *   pnpm web [seed] [radii] [turns] [loopRate]
 * e.g. pnpm web orb 8 4 0.3
 *
 * A dev tool, not shipped: the PNG writer below is here so the script needs no
 * dependency, since adding one to this repo for a preview would be a poor
 * trade.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { COLONY_NESTS, COLS, ROWS, makeRng } from "@stigsim/sim-core";
import { buildWeb, transpileWeb, isConnected, reachableFrom } from "@stigsim/sim-core";
import type { Point } from "@stigsim/sim-core";

const seed = process.argv[2] ?? "orb";
const radii = Number(process.argv[3] ?? 8);
const turns = Number(process.argv[4] ?? 4);
const loopRate = Number(process.argv[5] ?? 0);

// ─── A minimal PNG writer ────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGB pixels, row-major, to a PNG buffer. */
function png(width: number, height: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour
  // 10-12: compression, filter, interlace — all zero.

  // Each scanline is prefixed with filter byte 0 (none).
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const src = y * width * 3;
    const dst = y * (1 + width * 3);
    raw[dst] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + src, width * 3).copy(raw, dst + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── Palette, from DESIGN.md ─────────────────────────────────────────────────

const hex = (s: string): [number, number, number] => [
  parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16),
];

const WALL = hex("#0f0a04");      // background
const DRY = hex("#e5d5b5");       // text — pale silk
const STICKY = hex("#f59e0b");    // primary amber — the trap
const NEST = hex("#4b9eff");      // colony 0 blue
const UNREACHED = hex("#ef8b55"); // danger — an open cell no ant can get to

// ─── Build ───────────────────────────────────────────────────────────────────

const extra = Number(process.argv[6] ?? 4);

const rng = makeRng(seed);
const anchors: Point[] = COLONY_NESTS.map(([x, y]) => ({ x: x / (COLS - 1), y: y / (ROWS - 1) }));

// Extra anchors spread along the boundary between the nests. A frame through
// four corners is a square, and square rings read as concentric boxes rather
// than a web; more anchors round it off. The nests stay anchors regardless,
// which is what keeps every colony on the web.
const lo = 1 / (COLS - 1);
const hi = 1 - lo;
const edges: Point[] = [];
for (let i = 0; i < extra; i++) {
  const t = (i + 0.5) / extra;
  const side = i % 4;
  const along = lo + (hi - lo) * (0.2 + 0.6 * ((t * 7) % 1));
  if (side === 0) edges.push({ x: along, y: lo });
  else if (side === 1) edges.push({ x: hi, y: along });
  else if (side === 2) edges.push({ x: along, y: hi });
  else edges.push({ x: lo, y: along });
}
anchors.push(...edges);
const plan = buildWeb(rng, anchors, { radii, turns, loopRate });
const { grid, sticky } = transpileWeb(plan, COLS, ROWS);

const [nx, ny] = COLONY_NESTS[0];
const reached = reachableFrom(grid, nx, ny);

let open = 0;
let stuck = 0;
let trap = 0;
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    if (grid[y][x] !== 1) continue;
    open++;
    if (sticky[y][x]) trap++;
    if (!reached[y][x]) stuck++;
  }
}

// ─── Draw ────────────────────────────────────────────────────────────────────

const SCALE = 16;
const width = COLS * SCALE;
const height = ROWS * SCALE;
const pixels = new Uint8Array(width * height * 3);

const nests = new Set(COLONY_NESTS.map(([x, y]) => `${x},${y}`));

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const cx = Math.floor(x / SCALE);
    const cy = Math.floor(y / SCALE);
    let colour = WALL;
    if (grid[cy][cx] === 1) {
      if (nests.has(`${cx},${cy}`)) colour = NEST;
      else if (!reached[cy][cx]) colour = UNREACHED;
      else if (sticky[cy][cx]) colour = STICKY;
      else colour = DRY;
    }
    const i = (y * width + x) * 3;
    pixels[i] = colour[0];
    pixels[i + 1] = colour[1];
    pixels[i + 2] = colour[2];
  }
}

mkdirSync("preview", { recursive: true });
const file = `preview/web-${seed}-r${radii}-t${turns}-l${loopRate}.png`;
writeFileSync(file, png(width, height, pixels));

// ─── Report ──────────────────────────────────────────────────────────────────

for (let y = 0; y < ROWS; y++) {
  let row = "";
  for (let x = 0; x < COLS; x++) {
    if (grid[y][x] !== 1) row += "  ";
    else if (nests.has(`${x},${y}`)) row += "NN";
    else if (!reached[y][x]) row += "??";
    else if (sticky[y][x]) row += "##";
    else row += "..";
  }
  console.log(row);
}

console.log();
console.log(`seed=${seed} radii=${radii} turns=${turns} loopRate=${loopRate}`);
console.log(`strands   ${plan.strands.length}`);
console.log(`open      ${open} of ${COLS * ROWS} cells (${((open / (COLS * ROWS)) * 100).toFixed(1)}%)`);
console.log(`sticky    ${trap} (${((trap / open) * 100).toFixed(1)}% of open)`);
console.log(`connected ${isConnected(grid) ? "yes" : `NO — ${stuck} open cells unreachable`}`);
console.log(`nests on the web: ${COLONY_NESTS.filter(([x, y]) => grid[y][x] === 1).length} of ${COLONY_NESTS.length}`);
console.log(`wrote ${file}`);
