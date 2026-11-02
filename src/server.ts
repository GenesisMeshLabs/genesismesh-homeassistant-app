import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { parseJson } from 'genesis-mesh-sdk';
import { actionSchema, type ActionIntent, type Principal, type RuntimeConfig } from './contracts.js';
import { validateConfig } from './config.js';
import { authenticate } from './identity.js';
import { AppError } from './errors.js';
import { Executor } from './executor.js';
import { Journal } from './journal.js';
import { definitions, legacyCapabilities } from './device-actions.js';

export function createServer(input: RuntimeConfig | (() => RuntimeConfig | undefined), executor: Pick<Executor, 'execute'>, journal: Journal, profile: 'standalone' | 'supervisor' = 'standalone'): FastifyInstance {
  const configFor = () => {
    const value = typeof input === 'function' ? input() : input;
    if (!value) throw new AppError('setup_required', 'The home has not finished access setup.', 409);
    return validateConfig(value, profile);
  };
  if (typeof input !== 'function') configFor();
  const app = Fastify({
    logger: false, bodyLimit: 4096, requestTimeout: 10000,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: false } },
  });
  // SDK strict JSON rejects duplicate keys and ambiguous numeric forms before schema validation.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    try { done(null, parseJson(String(body))); } catch { done(new AppError('invalid_json', 'The request body is not valid strict JSON.')); }
  });
  const principal = (request: FastifyRequest): Principal => authenticate(request.headers.authorization, configFor().principals);
  app.addHook('onRequest', async request => {
    if (request.headers.origin) throw new AppError('browser_origin_not_supported', 'This preview API accepts authenticated service clients only.', 403);
    if (request.url !== '/health') principal(request);
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    return payload;
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    const status = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 503;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: 'invalid_request', message: 'The request has missing, unknown or invalid fields.' } });
    }
    return reply.code(503).send({ error: { code: 'executor_unavailable', message: 'The executor could not safely complete this request. No automatic retry was made.' } });
  });
  app.get('/health', async () => ({ service: 'genesismesh-homeassistant-app', status: 'running', profile: 'p0-service-client-preview' }));
  app.get('/v1/resources', async request => {
    const config = configFor();
    const who = principal(request);
    return { homeId: config.homeId, participant: { id: who.id, kind: who.kind, assurance: 'app-bearer-possession' },
      resources: config.resources.filter(r => who.resources.includes(r.id)).map(r => ({
        id: r.id, name: r.name, kind: r.kind,
        capabilities: definitions.filter(d => ((d.kinds as readonly string[]).includes(r.kind) || (d.kinds as readonly string[]).includes('*')) &&
          (who.capabilities ?? legacyCapabilities).includes(d.capability)).map(d => d.capability),
      })) };
  });
  app.post<{ Body: ActionIntent }>('/v1/actions', { schema: { body: actionSchema } }, async (request, reply) => {
    const op = await executor.execute(principal(request), request.body);
    const status = op.commandState === 'denied' ? 403 : op.commandState === 'blocked' ? 503
      : op.commandState === 'outcome_unknown' ? 202 : 200;
    return reply.code(status).send(op);
  });
  app.get<{ Params: { id: string } }>('/v1/operations/:id', async (request, reply) => {
    const op = journal.get(request.params.id);
    if (!op || op.subjectId !== principal(request).id) return reply.code(404).send({ error: { code: 'not_found', message: 'Operation not found.' } });
    return op;
  });
  return app;
}
