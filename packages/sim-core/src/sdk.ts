import type {
  ModeCreateResult,
  ModeDefinition,
  ModeReference,
  ModeRuntime,
  JsonValue,
} from "./types";

const MODE_ID_MAX_LENGTH = 100;

/** True only when JSON serialization can retain the complete value. */
export function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value !== "object" || seen.has(value)) return false;

  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1 || ownKeys.some(key => typeof key !== "string")) return false;
    seen.add(value);
    const valid = value.every(item => isJsonValue(item, seen));
    seen.delete(value);
    return valid;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key !== "string" ||
      !Object.prototype.propertyIsEnumerable.call(value, key))) return false;

  seen.add(value);
  const valid = Object.values(value).every(item => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

/** Stable lowercase identifiers, optionally grouped with `/` or `-`. */
export function isModeId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= MODE_ID_MAX_LENGTH &&
    /^[a-z][a-z0-9]*(?:[/-][a-z0-9]+)*$/.test(value);
}

/** Behavior versions start at one and advance only for intentional changes. */
export function isModeVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function keyOf(id: string, version: number): string {
  return `${id}@${version}`;
}

function assertModeIdentity(mode: Pick<ModeDefinition<unknown, ModeRuntime>, "id" | "version">): void {
  if (!isModeId(mode.id)) {
    throw new TypeError(`Invalid mode id: ${String(mode.id)}`);
  }
  if (!isModeVersion(mode.version)) {
    throw new TypeError(`Invalid mode version: ${String(mode.version)}`);
  }
}

/** Preserve inferred config/runtime types while validating the public identity. */
export function defineMode<Config, Runtime extends ModeRuntime>(
  mode: ModeDefinition<Config, Runtime>,
): ModeDefinition<Config, Runtime> {
  assertModeIdentity(mode as ModeDefinition<unknown, ModeRuntime>);
  return mode;
}

type RegisteredMode = ModeDefinition<unknown, ModeRuntime>;

/** Exact-version registry used by hosts and trace loaders. */
export class ModeRegistry {
  private readonly modes = new Map<string, RegisteredMode>();

  register<Config, Runtime extends ModeRuntime>(
    mode: ModeDefinition<Config, Runtime>,
  ): this {
    assertModeIdentity(mode as ModeDefinition<unknown, ModeRuntime>);
    const key = keyOf(mode.id, mode.version);
    if (this.modes.has(key)) throw new Error(`Mode ${key} is already registered.`);
    this.modes.set(key, mode as RegisteredMode);
    return this;
  }

  resolve(id: string, version: number): RegisteredMode | undefined {
    return this.modes.get(keyOf(id, version));
  }

  create(reference: ModeReference): ModeCreateResult {
    if (!isModeId(reference.id) || !isModeVersion(reference.version)) {
      return { ok: false, error: "Mode reference has an invalid identity." };
    }
    const mode = this.resolve(reference.id, reference.version);
    if (!mode) {
      return { ok: false, error: `Mode ${keyOf(reference.id, reference.version)} is not registered.` };
    }
    const parsed = mode.parseConfig(reference.config);
    if (!parsed.ok) return parsed;
    return {
      ok: true,
      instance: {
        reference: { id: mode.id, version: mode.version, config: parsed.value },
        runtime: mode.create(parsed.value),
      },
    };
  }
}
