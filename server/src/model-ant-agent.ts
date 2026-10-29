import { AGENT_PROMPT, AGENT_RULES, AGENT_TOOLS, MAX_POLICY_CHARACTERS, parseDecision, type AgentObservation, type AgentStep, type AgentUsage, type AgentEvent } from '../../shared/model-ant';
interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
interface Message { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }
interface ProviderReply {
  choices?: { finish_reason?: string; message?: { content?: unknown; refusal?: string; tool_calls?: ToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
export interface AgentSession {
  suppliedPolicy?: import('../../shared/model-ant-config').Strategy;
  customPolicy?: string;
  initialHeading?: import('../../shared/model-ant').Direction;
  model?: string;
  runMode?: 'agent' | 'selection';
  observationSupport?: 'raw-history' | 'observed-map';
  selectionHistory?: { observation: AgentObservation; action: string }[];
  policy: string;
  policyRevision: number;
  messages: Message[];
  pendingCall?: string;
  expectedTurn: number;
  lastObservation?: string;
  lastStep?: AgentStep;
  summary: string;
  compactions: number;
  touched: number;
}
export function createAgentSession(): AgentSession {
  return { policy: '', policyRevision: 0, messages: [], expectedTurn: 0, summary: '', compactions: 0, touched: Date.now() };
}
export function canonicalObservation(v: AgentObservation): AgentObservation {
  return { turn: v.turn, position: { x: v.position.x, y: v.position.y },
    neighbors: { north: v.neighbors.north, east: v.neighbors.east, south: v.neighbors.south, west: v.neighbors.west },
    pebbles: { carried: v.pebbles.carried, here: v.pebbles.here, neighbors: {
      north: v.pebbles.neighbors.north, east: v.pebbles.neighbors.east, south: v.pebbles.neighbors.south, west: v.pebbles.neighbors.west,
    } }, lastResult: v.lastResult };
}
const readText = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content)
  ? content.map(p => p && typeof p.text === 'string' ? p.text : '').join('') : '';
function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function sumTokens(a: number | null, b: number | null): number | null { return a === null || b === null ? null : a + b; }
export class AgentRequestError extends Error {
  constructor(message: string, public usage: AgentUsage, public events: AgentEvent[]) { super(message); }
}
export async function requestAgentStep(session: AgentSession, observation: AgentObservation,
  config: { base: string; token?: string; model: string }, request: typeof fetch = fetch): Promise<AgentStep> {
  const canonical = canonicalObservation(observation);
  const serialized = JSON.stringify(canonical);
  // A lost HTTP response may be retried, but never incurs another model request.
  if (session.lastObservation === serialized && session.lastStep) { session.touched = Date.now(); return session.lastStep; }
  if (observation.turn !== session.expectedTurn) throw new Error('Model conversation is out of sync. Reset this experiment.');
  let messages = session.messages.map(m => ({ ...m }));
  if (session.pendingCall) messages.push({ role: 'tool', tool_call_id: session.pendingCall, content: JSON.stringify({ ...canonical, previousRequestUsage: session.lastStep?.usage }) });
  else messages.push({ role: 'user', content: serialized });
  const start = Date.now();
  const usage: AgentUsage = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const events: AgentEvent[] = [];
  let summary = session.summary, compactions = session.compactions;
  let policy = session.policy, policyRevision = session.policyRevision;
  const signal = AbortSignal.timeout(60000);
  try {
    for (let round = 0; round < 6; round++) {
      if (JSON.stringify(messages).length > 250000) throw new Error('Model context reached the experiment limit without compaction. Reset this experiment.');
      usage.requests++;
      const response = await request(`${config.base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
        body: JSON.stringify({ model: config.model, max_tokens: 2400, tools: AGENT_TOOLS, ...(config.model.startsWith('claude-') ? {} : { parallel_tool_calls: false }),
          messages: [{ role: 'system', content: `${AGENT_PROMPT}\n\n${AGENT_RULES}` },
            ...(policyRevision > 0 ? [{ role: 'assistant', content: `My persistent policy (revision ${policyRevision}):\n${policy || '(blank)'}` }] : []), ...messages] }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { error?: { unavailable_reason?: string } } | null;
        if (failure?.error?.unavailable_reason === 'credits_required') throw new Error('Model provider needs AI Gateway credits. Add credits in Neon billing, then retry.');
        throw new Error(`Model provider returned HTTP ${response.status}. Check server configuration or quota.`);
      }
      const data = await response.json() as ProviderReply;
      usage.inputTokens = sumTokens(usage.inputTokens, tokenCount(data.usage?.prompt_tokens));
      usage.outputTokens = sumTokens(usage.outputTokens, tokenCount(data.usage?.completion_tokens));
      usage.totalTokens = sumTokens(usage.totalTokens, tokenCount(data.usage?.total_tokens));
      const choice = data?.choices?.[0], message = choice?.message;
      if (choice?.finish_reason === 'length') throw new Error('Model response reached its output limit. No move was applied; retry.');
      if (message?.refusal) throw new Error('Model declined to act. No move was applied.');
      const text = readText(message?.content);
      if (text) events.push({ type: 'explanation', text });
      const calls = message?.tool_calls ?? [];
      if (calls.length > 1) throw new Error('Model requested multiple simultaneous actions. No move was applied; retry.');
      if (calls.length === 0) {
        if (!text) throw new Error('Model returned no action or explanation. No move was applied; retry.');
        messages.push({ role: 'assistant', content: text });
        continue;
      }
      const call = calls[0];
      if (typeof call.id !== 'string' || call.type !== 'function') throw new Error('Model returned an invalid tool call.');
      let args: Record<string, unknown>;
      try { args = JSON.parse(call.function.arguments); } catch { throw new Error('Model returned invalid tool arguments. No move was applied; retry.'); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Model returned invalid tool arguments.');
      messages.push({ role: 'assistant', content: text || null, tool_calls: [call] });
      if (call.function.name === 'update_policy') {
        if (typeof args.policy !== 'string' || args.policy.length > MAX_POLICY_CHARACTERS) throw new Error('Model returned an invalid policy document.');
        const previousPolicy = policy;
        policy = args.policy; policyRevision++;
        events.push({ type: 'policy', text: policy, revision: policyRevision, previousPolicy });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ updated: true, revision: policyRevision, policy }) });
        continue;
      }
      if (call.function.name === 'compact_context') {
        if (typeof args.summary !== 'string' || !args.summary.trim() || args.summary.length > 12000) throw new Error('Model returned an invalid context summary.');
        summary = args.summary; compactions++;
        events.push({ type: 'compaction', text: summary });
        // Keep the summary as model-authored text, never promote it to system authority.
        messages = [{ role: 'assistant', content: `My continuation summary:\n${summary}` }, { role: 'user', content: serialized }];
        continue;
      }
      if (call.function.name !== 'act') throw new Error('Model requested an unknown tool.');
      const decision = parseDecision({ direction: args.direction, pebbleAction: args.pebbleAction, reason: '', memory: '' });
      events.push({ type: 'action', text: JSON.stringify({ direction: decision.direction, pebbleAction: decision.pebbleAction }) });
      const step: AgentStep = { policy, policyRevision, decision, events, usage, contextMessages: messages.length + 1, compactions, summary,
        model: config.model, elapsedMs: Date.now() - start };
      // Commit only after a valid action; a failed request cannot advance the environment or context.
      Object.assign(session, { policy, policyRevision, messages, pendingCall: call.id, expectedTurn: observation.turn + 1,
        lastObservation: serialized, lastStep: step, summary, compactions, touched: Date.now() });
      return step;
    }
    throw new Error('Model did not act within six requests. No move was applied; retry or reset.');
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith('Model') ? error.message : 'Model request failed or timed out. No move was applied; retry.';
    // Missing usage on transport/provider failures means unavailable, never zero.
    throw new AgentRequestError(message, { ...usage, inputTokens: null, outputTokens: null, totalTokens: null }, events);
  }
}
