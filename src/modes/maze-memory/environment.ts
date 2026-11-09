import {
  DELTAS,
  DIRECTIONS,
  type LocalObservation,
  type Move,
} from "./contract";
export type JsonMark =
  | null
  | boolean
  | number
  | string
  | JsonMark[]
  | { [key: string]: JsonMark };
export const MARK_LIMITS = {
  locationBytes: 2048,
  writeBytes: 8192,
  mazeBytes: 1048576,
  writes: 16,
  depth: 32,
} as const;
export interface MarkWrite {
  target: "cell" | "chosenPassage" | Move;
  value: JsonMark;
  when?: "chosen";
}
export interface LocalMarks {
  cell: JsonMark;
  passages: Partial<Record<Move, JsonMark>>;
}
const bytes = (v: unknown) =>
  new TextEncoder().encode(JSON.stringify(v)).length;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function validJson(v: unknown, depth = 0): boolean {
  if (depth > MARK_LIMITS.depth) return false;
  if (v === null || typeof v === "string" || typeof v === "boolean")
    return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => validJson(x, depth + 1));
  return (
    typeof v === "object" &&
    Object.values(v!).every((x) => validJson(x, depth + 1))
  );
}
export function parseWrites(value: unknown): MarkWrite[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > MARK_LIMITS.writes ||
    bytes(value) > MARK_LIMITS.writeBytes
  )
    throw Error("At most 16 writes and 8 KiB of write data per decision.");
  return value.map((w) => {
    if (
      !w ||
      typeof w !== "object" ||
      !["cell", "chosenPassage", ...DIRECTIONS].includes(w.target) ||
      !Object.hasOwn(w, "value") ||
      Object.keys(w).some((k) => !["target", "value", "when"].includes(k)) ||
      !validJson(w.value) ||
      bytes(w.value) > MARK_LIMITS.locationBytes ||
      (w.when !== undefined &&
        (w.when !== "chosen" || !DIRECTIONS.includes(w.target)))
    )
      throw Error(
        'Write requires a local target and JSON value (2 KiB/location, depth 32); optional when:"chosen" requires a compass passage.',
      );
    return clone(w);
  });
}
export class EnvironmentMemory {
  private marks = new Map<string, JsonMark>();
  private payloadBytes = 0;
  private key(o: LocalObservation, target: "cell" | Move) {
    const { x, y } = o.position;
    if (target === "cell") return `c:${x},${y}`;
    const [dx, dy] = DELTAS[target];
    return "p:" + [`${x},${y}`, `${x + dx},${y + dy}`].sort().join("|");
  }
  private read(key: string) {
    return clone(this.marks.get(key) ?? null);
  }
  local(o: LocalObservation): LocalMarks {
    return {
      cell: this.read(this.key(o, "cell")),
      passages: Object.fromEntries(
        DIRECTIONS.filter((d) => o.exits[d]).map((d) => [
          d,
          this.read(this.key(o, d)),
        ]),
      ),
    };
  }
  private stage(o: LocalObservation, writes: MarkWrite[], chosen: Move) {
    const next = new Map(this.marks);
    let payloadBytes = this.payloadBytes;
    for (const w of writes) {
      if (
        (w.target === "chosenPassage" && !o.exits[chosen]) ||
        (w.when === "chosen" && (!o.exits[chosen] || w.target !== chosen))
      )
        continue;
      const target = w.target === "chosenPassage" ? chosen : w.target,
        key = this.key(o, target);
      if (next.has(key)) payloadBytes -= bytes(key) + 1 + bytes(next.get(key));
      if (w.value === null) next.delete(key);
      else {
        next.set(key, clone(w.value));
        payloadBytes += bytes(key) + 1 + bytes(w.value);
      }
    }
    if (2 + payloadBytes + Math.max(0, next.size - 1) > MARK_LIMITS.mazeBytes)
      throw Error("Environmental memory exceeds 1 MiB per maze.");
    return { marks: next, payloadBytes };
  }
  validate(o: LocalObservation, writes: MarkWrite[]) {
    parseWrites(writes);
    for (const w of writes)
      if (DIRECTIONS.includes(w.target as Move) && !o.exits[w.target as Move])
        throw Error("Cannot write a blocked passage.");
    for (const d of DIRECTIONS) this.stage(o, writes, d);
  }
  commit(o: LocalObservation, writes: MarkWrite[], chosen: Move) {
    this.validate(o, writes);
    const staged = this.stage(o, writes, chosen);
    this.marks = staged.marks;
    this.payloadBytes = staged.payloadBytes;
  }
  export() {
    return clone(Object.fromEntries(this.marks));
  }
}
