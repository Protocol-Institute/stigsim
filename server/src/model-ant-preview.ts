import { swarmAntRouter } from './swarm-ant';
// Isolated preview: no production world, database or multiplayer services.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { modelAntRouter } from './model-ant';
import { previewAccess, previewEnabled } from './model-ant-preview-access';
if (!previewEnabled(process.env)) throw new Error('Preview requires MODEL_ANT_PREVIEW_ENABLED=true and a password of at least 16 characters.');
const app = express();
app.get('/api/healthz', (_req,res) => res.json({ok:true}));
app.use(previewAccess(process.env.MODEL_ANT_PREVIEW_PASSWORD!));
app.use(express.json({limit:'16kb'}));
app.use('/api/model-ant',modelAntRouter());
app.use('/api/swarm-ant',swarmAntRouter());
const dist=fileURLToPath(new URL('../../dist',import.meta.url));
app.use(express.static(dist));
app.use((req,res,next)=>{if(req.method==='GET' && req.accepts('html')) res.sendFile(join(dist,'index.html')); else next();});
app.listen(Number(process.env.PORT ?? 3001),'0.0.0.0',()=>console.log('[model-ant-preview] Listening'));
