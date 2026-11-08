import {
  DIRECTIONS,
  type LocalObservation,
  type Move,
} from "../src/modes/maze-memory/contract";
import type { Prepared } from "../src/modes/maze-memory/contract";
import type { ModelAnswer } from "../src/modes/maze-memory/record";
export interface ProviderConfig {
  model: string;
  base: string;
  decisionBase: string;
  token?: string;
}
export function providerConfig(env = process.env): ProviderConfig {
  return {
    model: env.MAZE_MEMORY_MODEL || env.ANT_MODEL || "typesafeai-jev-1-14-0",
    base:
      env.ANT_MODEL_BASE_URL ||
      (env.NEON_AI_GATEWAY_BASE_URL
        ? `${env.NEON_AI_GATEWAY_BASE_URL.replace(/\/$/, "")}/v1`
        : ""),
    decisionBase:
      env.ANT_DECISION_BASE_URL ||
      (env.NEON_AI_GATEWAY_BASE_URL
        ? `${env.NEON_AI_GATEWAY_BASE_URL.replace(/\/$/, "")}/typesafe/v1`
        : ""),
    token: env.ANT_MODEL_API_KEY || env.NEON_AI_GATEWAY_TOKEN,
  };
}
export const isDecision = (c: ProviderConfig) =>
  c.model.startsWith("typesafeai-");
export const ready = (c: ProviderConfig) =>
  !!(isDecision(c) ? c.decisionBase : c.base);
const count = (x: unknown): number | null =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : null;
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: string,
    readonly usage = {
      inputTokens: null as number | null,
      outputTokens: null as number | null,
      totalTokens: null as number | null,
    },
  ) {
    super(message);
  }
}
export const QUESTION =
  "Choose exactly one movement direction: N, E, S, or W. You are the decision-maker. Follow the submitted system instructions using the supplied local observation and memory context. A blocked direction consumes a move. No movement will be selected automatically.";
export async function askModel(
  config: ProviderConfig,
  p: Prepared,
  observation: LocalObservation,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<ModelAnswer> {
  const state = {
    goal: "Find the unknown exit efficiently.",
    observation,
    systemInstructions: p.instructions,
    localContext: p.context,
  };
  const criteria = Object.fromEntries(
    DIRECTIONS.map((d) => [
      d,
      `Move ${d}. This adjacent passage is ${observation.exits[d] ? "open" : "blocked by a wall"}.`,
    ]),
  );
  const typesafe = isDecision(config);
  const payload = typesafe
    ? {
        model: config.model,
        state,
        questions: {
          action: { type: "choice", instructions: QUESTION, criteria },
        },
      }
    : {
        model: config.model,
        max_tokens: 128,
        temperature: 0,
        messages: [
          { role: "system", content: QUESTION },
          { role: "user", content: JSON.stringify(state) },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "choose_move",
              description: "Choose the ant movement.",
              parameters: {
                type: "object",
                properties: { move: { type: "string", enum: DIRECTIONS } },
                required: ["move"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "choose_move" } },
        parallel_tool_calls: false,
      };
  let response: Response;
  try {
    response = await request(
      `${(typesafe ? config.decisionBase : config.base).replace(/\/$/, "")}/${typesafe ? "systemone" : "chat/completions"}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      },
    );
  } catch {
    throw new ProviderError(
      "Model request was cancelled, failed or timed out. No move was applied.",
      "transport",
    );
  }
  // Bound remote data before parsing; never return provider bodies or credentials to the browser.
  const reader = response.body?.getReader(),
    decoder = new TextDecoder();
  let body = "",
    bytes = 0;
  try {
    if (!reader) throw new Error();
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      bytes += r.value.byteLength;
      if (bytes > 100000) {
        await reader.cancel();
        throw new Error();
      }
      body += decoder.decode(r.value, { stream: true });
    }
  } catch {
    throw new ProviderError(
      "Model response could not be read within limits. No move was applied.",
      "response",
    );
  }
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    throw new ProviderError(
      `Model returned non-JSON (HTTP ${response.status}). No move was applied.`,
      "response",
    );
  }
  const usage = {
    inputTokens: count(
      typesafe ? data.usage?.input_tokens : data.usage?.prompt_tokens,
    ),
    outputTokens: count(
      typesafe ? data.usage?.output_tokens : data.usage?.completion_tokens,
    ),
    totalTokens: count(data.usage?.total_tokens),
  };
  if (
    usage.totalTokens === null &&
    usage.inputTokens !== null &&
    usage.outputTokens !== null
  )
    usage.totalTokens = usage.inputTokens + usage.outputTokens;
  if (!response.ok)
    throw new ProviderError(
      `Model provider returned HTTP ${response.status}. Check local configuration or credits. No move was applied.`,
      "provider",
      usage,
    );
  let move: unknown,
    confidence: number | null = null;
  if (typesafe) {
    const a = data.answers?.action;
    if (a?.type === "choice") {
      move = a.choice;
      confidence =
        typeof a.confidence === "number" &&
        Number.isFinite(a.confidence) &&
        a.confidence >= 0 &&
        a.confidence <= 1
          ? a.confidence
          : null;
    }
  } else {
    const choice = data.choices?.[0],
      calls = choice?.message?.tool_calls;
    if (
      choice?.finish_reason !== "length" &&
      !choice?.message?.refusal &&
      Array.isArray(calls) &&
      calls.length === 1 &&
      calls[0].function?.name === "choose_move"
    )
      try {
        move = JSON.parse(calls[0].function.arguments).move;
      } catch {
        /* reject below */
      }
  }
  if (!DIRECTIONS.includes(move as Move))
    throw new ProviderError(
      "Model did not return one valid N/E/S/W choice. No move was applied.",
      "invalid-action",
      usage,
    );
  return {
    move: move as Move,
    model: config.model,
    servedModel:
      typeof data.model === "string" ? data.model.slice(0, 200) : null,
    confidence,
    ...usage,
  };
}
