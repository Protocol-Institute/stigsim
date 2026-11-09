import { Router } from 'express';
import { DEFAULT_DOCTRINE } from '@stigsim/sim-core';
import { isDecisionModel } from '../../shared/model-ant';
import { validateWarDecision, WAR_MODEL_RULES } from '../../shared/model-war';
import { previewAccess, previewEnabled } from './model-ant-preview-access';
export function modelWarRouter(env = process.env, request: typeof fetch = fetch) {
  const router = Router();
  const base = env.ANT_MODEL_BASE_URL || (env.NEON_AI_GATEWAY_BASE_URL ? `${env.NEON_AI_GATEWAY_BASE_URL.replace(/\/$/, '')}/v1` : '');
  const token = env.ANT_MODEL_API_KEY || env.NEON_AI_GATEWAY_TOKEN;
  const models = [...new Set([env.ANT_MODEL, ...(env.ANT_ALLOWED_MODELS?.split(',') ?? (env.NEON_AI_GATEWAY_BASE_URL ? ['gpt-5-mini', 'claude-sonnet-4-6'] : []))].map(m => m?.trim()).filter((m): m is string => !!m && !isDecisionModel(m)))];
  const enabled = env.NODE_ENV !== 'production' || previewEnabled(env);
  if (env.NODE_ENV === 'production' && previewEnabled(env)) router.use(previewAccess(env.MODEL_ANT_PREVIEW_PASSWORD!));
  router.get('/status', (_req, res) => res.json({ ready: enabled && !!base && models.length >= 2, models: enabled ? models : [] }));
  let busy = false;
  router.post('/decide', async (req, res) => {
    const { model, state, memory = '' } = req.body ?? {};
    if (!enabled || !base) { res.status(503).json({error:'Configure the local model server first.'}); return; }
    if (!models.includes(model) || !state || typeof state !== 'object' || typeof memory !== 'string' || memory.length > 4000 || JSON.stringify(state).length > 48000) { res.status(400).json({error:'Invalid model or observation.'}); return; }
    if (busy) { res.status(429).json({error:'A decision is in progress. Retry this turn.'}); return; }
    busy = true;
    try {
      const response = await request(`${base.replace(/\/$/, '')}/chat/completions`, {
        method:'POST', signal:AbortSignal.timeout(90000), headers:{'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})},
        body:JSON.stringify({model,max_tokens:4000,tools:[{type:'function',function:{name:'submit_strategy',description:'Choose doctrine and update private strategy memory.',parameters:{type:'object',properties:{doctrineJson:{type:'string',description:`Complete doctrine JSON, for example ${JSON.stringify(DEFAULT_DOCTRINE)}`},analysis:{type:'string'},memory:{type:'string'}},required:['doctrineJson','analysis','memory'],additionalProperties:false}}}],tool_choice:{type:'function',function:{name:'submit_strategy'}},...(model.startsWith('claude-')?{}:{parallel_tool_calls:false}),messages:[{role:'system',content:WAR_MODEL_RULES},{role:'user',content:JSON.stringify({state,memory})}]})
      });
      if (!response.ok) throw new Error(`Model service returned HTTP ${response.status}. Retry the paused decision.`);
      const data = await response.json() as any;
      const choice = data.choices?.[0], calls = choice?.message?.tool_calls;
      if (choice?.finish_reason === 'length' || !Array.isArray(calls) || calls.length !== 1 || calls[0]?.function?.name !== 'submit_strategy') throw new Error('Incomplete model strategy. Retry the paused decision.');
      const args = JSON.parse(calls[0].function.arguments);
      const decision = validateWarDecision({...args, doctrine:JSON.parse(args.doctrineJson)});
      res.json({...decision,model,servedModel:data.model,usage:data.usage ?? null});
    } catch (error) { res.status(502).json({error:error instanceof Error ? error.message : 'Model request failed.'}); }
    finally { busy = false; }
  });
  return router;
}
