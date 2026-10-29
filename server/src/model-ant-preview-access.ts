import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
export function previewEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.MODEL_ANT_PREVIEW_ENABLED === 'true' && (env.MODEL_ANT_PREVIEW_PASSWORD?.length ?? 0) >= 16;
}
export function previewAccess(password: string): RequestHandler {
  const expected = createHash('sha256').update(`preview:${password}`).digest();
  return (req, res, next) => {
    const header = req.get('authorization') ?? '';
    const credentials = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
    const actual = createHash('sha256').update(credentials).digest();
    if (timingSafeEqual(actual, expected)) { next(); return; }
    res.set('WWW-Authenticate', 'Basic realm="Stigsim preview", charset="UTF-8"');
    res.set('Cache-Control', 'no-store');
    res.status(401).send('This preview requires the shared access password.');
  };
}
