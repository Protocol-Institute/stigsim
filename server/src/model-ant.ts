import { previewAccess, previewEnabled } from './model-ant-preview-access';
import { validStrategy } from '../../shared/model-ant-config';
import { Router, type IRouter } from 'express';
import { isAgentObservation, isDecisionModel } from '../../shared/model-ant';
import { requestSelectionStep } from './model-ant-selection';
import { AgentRequestError, createAgentSession, requestAgentStep, type AgentSession } from './model-ant-agent';

export function modelAntRouter(env = process.env, request: typeof fetch = fetch): IRouter {
  const router = Router();
  const base = env.ANT_MODEL_BASE_URL || (env.NEON_AI_GATEWAY_BASE_URL ? `${env.NEON_AI_GATEWAY_BASE_URL.replace(/\/$/, '')}/v1` : '');
  const token = env.ANT_MODEL_API_KEY || env.NEON_AI_GATEWAY_TOKEN;
  const model = env.ANT_MODEL;
  const mode = env.ANT_EXPERIMENT_MODE === 'selection' || isDecisionModel(model ?? '') ? 'selection' : 'agent';
  const decisionBase = env.ANT_DECISION_BASE_URL || (env.NEON_AI_GATEWAY_BASE_URL ? `${env.NEON_AI_GATEWAY_BASE_URL.replace(/\/$/, '')}/typesafe/v1` : '');
  const sharedPreview = previewEnabled(env);
  if (env.NODE_ENV === 'production' && sharedPreview) router.use(previewAccess(env.MODEL_ANT_PREVIEW_PASSWORD!));
  const enabled = (env.NODE_ENV !== 'production' || sharedPreview) && !!model && (isDecisionModel(model) ? !!decisionBase : !!base);
  const models = [...new Set([model, ...(env.ANT_ALLOWED_MODELS?.split(',').map(id => id.trim()).filter(Boolean) ?? (env.NEON_AI_GATEWAY_BASE_URL ? ['typesafeai-jev-1-14-0', 'openjev-qwen35-4b', 'gpt-5-mini', 'claude-sonnet-4-6'] : []))].filter((id): id is string => !!id))].filter(id => isDecisionModel(id) ? !!decisionBase : !!base);
  const sessions = new Map<string, AgentSession>();
  let busy = false;
  router.get('/status', (_req, res) => {
    res.json({ ready: enabled, model: model || null, mode, models, message: enabled ? 'Model configured.' : 'Configure ANT_MODEL and a model endpoint on the local server. See docs/model-ant.md.' });
  });
  router.delete('/sessions/:runId', (req, res) => { sessions.delete(req.params.runId); res.sendStatus(204); });
  router.post('/step', async (req, res) => {
    if (!enabled) { res.status(503).json({ error: 'Model Ant needs a configured local model server. See docs/model-ant.md.' }); return; }
    const { runId, observation, observationSupport = 'raw-history', suppliedPolicy = 'none', customPolicy = '', initialHeading = 'south', model: requestedModel = model } = req.body ?? {};
    const runMode = req.body?.experimentMode ?? mode;
    if (!['selection','agent'].includes(runMode) || (runMode === 'agent' && isDecisionModel(requestedModel))) {
      res.status(400).json({error:'This model supports action-only comparison, not policy authoring.'}); return;
    }
    if (!models.includes(requestedModel) || !['north','east','south','west'].includes(initialHeading) || typeof customPolicy !== 'string' || customPolicy.length > 8000 || (suppliedPolicy === 'custom' && !customPolicy.trim())) {
      res.status(400).json({ error: 'Invalid model, heading, or custom strategy.' }); return;
    }
    if (!validStrategy(suppliedPolicy) || (suppliedPolicy !== 'none' && runMode !== 'selection') || (suppliedPolicy === 'exploration-v1' && observationSupport !== 'observed-map')) {
      res.status(400).json({ error: 'Invalid supplied policy. Exploration policy requires observed-map selection mode.' }); return;
    }
    if (!['raw-history', 'observed-map'].includes(observationSupport) || (runMode !== 'selection' && observationSupport !== 'raw-history')) {
      res.status(400).json({ error: 'Invalid observation support for this experiment mode.' }); return;
    }
    if (typeof runId !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(runId) || !isAgentObservation(observation)) {
      res.status(400).json({ error: 'Invalid ant observation or run identity. Start a fresh experiment.' }); return;
    }
    if (busy) { res.status(429).json({ error: 'A model decision is already in progress.' }); return; }
    for (const [id, session] of sessions) if (Date.now() - session.touched > 3600000) sessions.delete(id);
    let session = sessions.get(runId);
    if (!session) {
      if (observation.turn !== 0) { res.status(409).json({ error: 'Model conversation expired or the server restarted. Reset this experiment.' }); return; }
      if (sessions.size >= 16) { res.status(429).json({ error: 'Experiment session limit reached. Reset an existing experiment or retry after an hour.' }); return; }
      session = createAgentSession(); session.observationSupport = observationSupport; session.suppliedPolicy = suppliedPolicy; session.customPolicy = customPolicy; session.initialHeading = initialHeading; session.model = requestedModel; sessions.set(runId, session);
    }
    if ((session.observationSupport ?? 'raw-history') !== observationSupport || (session.suppliedPolicy ?? 'none') !== suppliedPolicy || session.model !== requestedModel || session.customPolicy !== customPolicy || session.initialHeading !== initialHeading || session.runMode && session.runMode !== runMode) {
      res.status(409).json({ error: 'Model observation support changed. Reset this experiment.' }); return;
    }
    session.runMode = runMode;
    busy = true;
    try {
      res.json(runMode === 'selection'
        ? await requestSelectionStep(session, observation, { base, decisionBase, token, model: requestedModel }, request)
        : await requestAgentStep(session, observation, { base, token, model: requestedModel }, request));
    } catch (error) {
      const message = error instanceof Error && error.message.startsWith('Model') ? error.message : 'Model request failed. No move was applied; retry.';
      res.status(502).json({ error: message, ...(error instanceof AgentRequestError ? { usage: error.usage, events: error.events } : {}) });
    } finally { busy = false; }
  });
  return router;
}
