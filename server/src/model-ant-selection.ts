import { strategyText } from '../../shared/model-ant-config';
import { POLICY_ACTION_QUESTION, checkExplorationPolicy, checkRightHand } from '../../shared/model-ant-policy';
import { buildObservedMap, OBSERVED_MAP_RULES, AGENT_PROMPT, SELECTION_RULES, ACTION_QUESTION, ACTION_OPTIONS, SELECT_ACTION_TOOL, isDecisionModel,
  type AgentObservation, type AgentStep, type AgentUsage } from '../../shared/model-ant';
import { AgentRequestError, canonicalObservation, type AgentSession } from './model-ant-agent';

const count = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const probability = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
export function selectionState(session: AgentSession, observation: AgentObservation) {
  const history = session.selectionHistory ?? [];
  const assisted = session.observationSupport === 'observed-map';
  let heading = session.initialHeading ?? 'south';
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    const next = history[i + 1]?.observation ?? observation;
    if (entry.observation.position.x !== next.position.x || entry.observation.position.y !== next.position.y) heading = ACTION_OPTIONS.find(option => option.id === entry.action)!.direction;
  }
  const policy = strategyText(session.suppliedPolicy ?? 'none', session.customPolicy);
  return { ...(policy ? { policy } : {}), ...(session.suppliedPolicy === 'right-hand' ? { heading } : {}), goal: AGENT_PROMPT, rules: assisted ? OBSERVED_MAP_RULES : SELECTION_RULES, history, observation: canonicalObservation(observation),
    ...(assisted ? { observedMap: buildObservedMap([...history.map(entry => entry.observation), canonicalObservation(observation)]) } : {}) };
}
export async function requestSelectionStep(session: AgentSession, observation: AgentObservation,
  config: { base: string; decisionBase: string; token?: string; model: string }, request: typeof fetch = fetch): Promise<AgentStep> {
  const serialized = JSON.stringify(canonicalObservation(observation));
  if (session.lastObservation === serialized && session.lastStep) { session.touched = Date.now(); return session.lastStep; }
  if (session.expectedTurn !== observation.turn) throw new Error('Model conversation is out of sync. Reset this experiment.');
  const state = selectionState(session, observation);
  const actionQuestion = state.policy ? POLICY_ACTION_QUESTION : ACTION_QUESTION;
  const decisionModel = isDecisionModel(config.model);
  const criteria = Object.fromEntries(ACTION_OPTIONS.map(option => [option.id, option.description]));
  const usage: AgentUsage = { requests: 1, inputTokens: null, outputTokens: null, totalTokens: null };
  const start = Date.now();
  try {
    const response = await request(decisionModel ? `${config.decisionBase.replace(/\/$/, '')}/systemone` : `${config.base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
      body: JSON.stringify(decisionModel ? {
        model: config.model, state, questions: { action: { type: 'choice', instructions: actionQuestion, criteria } },
      } : {
        model: config.model, max_tokens: 2400, tools: [SELECT_ACTION_TOOL],
        tool_choice: { type: 'function', function: { name: 'select_action' } },
        ...(config.model.startsWith('claude-') ? {} : { parallel_tool_calls: false }),
        messages: [{ role: 'system', content: 'Choose one action from the provided state and options using select_action.' },
          { role: 'user', content: JSON.stringify({ state, question: { instructions: actionQuestion, criteria } }) }],
      }),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null) as any;
      if (failure?.error?.unavailable_reason === 'credits_required') throw new Error('Model provider needs AI Gateway credits. Add credits in Neon billing, then retry.');
      throw new Error(`Model provider returned HTTP ${response.status}. Check server configuration or quota.`);
    }
    const data = await response.json() as any;
    usage.inputTokens = count(decisionModel ? data.usage?.input_tokens : data.usage?.prompt_tokens);
    usage.outputTokens = count(decisionModel ? data.usage?.output_tokens : data.usage?.completion_tokens);
    usage.totalTokens = count(data.usage?.total_tokens) ?? (usage.inputTokens !== null && usage.outputTokens !== null ? usage.inputTokens + usage.outputTokens : null);
    let action: unknown, confidence: number | null = null, probabilities: Record<string, number> | null = null;
    if (decisionModel) {
      const answer = data.answers?.action;
      if (answer?.type !== 'choice') throw new Error('Model returned no action choice. No move was applied.');
      action = answer.choice;
      if (answer.confidence != null) {
        if (!probability(answer.confidence)) throw new Error('Model returned invalid confidence. No move was applied.');
        confidence = answer.confidence;
      }
      if (answer.probabilities != null) {
        if (typeof answer.probabilities !== 'object' || Array.isArray(answer.probabilities)) throw new Error('Model returned invalid probabilities.');
        probabilities = {};
        for (const [id, value] of Object.entries(answer.probabilities)) {
          if (!ACTION_OPTIONS.some(option => option.id === id) || !probability(value)) throw new Error('Model returned invalid action probabilities. No move was applied.');
          probabilities[id] = value;
        }
      }
    } else {
      const choice = data.choices?.[0];
      if (choice?.finish_reason === 'length' || choice?.message?.refusal) throw new Error('Model could not complete its action choice. No move was applied.');
      const calls = choice?.message?.tool_calls;
      if (!Array.isArray(calls) || calls.length !== 1 || calls[0]?.function?.name !== 'select_action') throw new Error('Model returned no single action choice. No move was applied.');
      try { action = JSON.parse(calls[0].function.arguments).action; } catch { throw new Error('Model returned invalid action arguments. No move was applied.'); }
    }
    const option = ACTION_OPTIONS.find(option => option.id === action);
    if (!option) throw new Error('Model chose an unknown action. No move was applied.');
    const step: AgentStep = { actionQuestion, ...(state.policy ? { suppliedPolicy: state.policy } : {}),
      ...(session.suppliedPolicy === 'exploration-v1' && state.observedMap ? { policyCheck: checkExplorationPolicy(state.observedMap, observation.position, option.direction) } : session.suppliedPolicy === 'right-hand' ? { policyCheck: checkRightHand(observation.neighbors, state.heading!, option.direction) } : {}), observationSupport: session.observationSupport ?? 'raw-history',
      ...(state.observedMap ? { observedMap: state.observedMap } : {}), decision: { direction: option.direction, pebbleAction: option.pebbleAction, reason: '', memory: '' },
      selection: { action: option.id, confidence, probabilities },
      events: [{ type: 'action', text: JSON.stringify({ action: option.id, direction: option.direction, pebbleAction: option.pebbleAction }) }],
      usage, contextMessages: state.history.length + 1, policy: '', policyRevision: 0, summary: '', compactions: 0,
      model: config.model, ...(typeof data.model === 'string' ? { servedModel: data.model } : {}), elapsedMs: Date.now() - start };
    Object.assign(session, { selectionHistory: [...state.history, { observation: state.observation, action: option.id }],
      expectedTurn: observation.turn + 1, lastObservation: serialized, lastStep: step, touched: Date.now() });
    return step;
  } catch (error) {
    throw new AgentRequestError(error instanceof Error && error.message.startsWith('Model') ? error.message : 'Model request failed or timed out. No move was applied; retry.', usage, []);
  }
}
