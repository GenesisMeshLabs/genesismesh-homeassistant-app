import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve, relative, extname, sep } from 'node:path';
import { parseJson } from 'genesis-mesh-sdk';
import { actionSchema, type ActionIntent, type ParticipantKind, capabilities, type Capability } from './contracts.js';
import { inventorySummary } from './inventory.js';
import { CsrfSessions, ingressUser, type HaRoles } from './ha-identity.js';
import { ManagedHome } from './managed-home.js';
import { AppError } from './errors.js';

export function createIngress(home: Pick<ManagedHome, 'status' | 'catalog' | 'configure' | 'addMember' | 'updateMember' | 'revoke' | 'act'>, roles: HaRoles, webRoot: string, healthy = () => true) {
  const app = Fastify({ logger: false, bodyLimit: 16384, trustProxy: false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: false } } });
  const sessions = new CsrfSessions();
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    try { done(null, parseJson(String(body))); } catch { done(new AppError('invalid_json', 'Invalid request body.')); }
  });
  app.addHook('onRequest', async request => {
    if (request.url === '/health') return;
    const user = ingressUser(request.ip, request.headers['x-remote-user-id']);
    if (request.method !== 'GET' && request.method !== 'HEAD') sessions.check(user, request.headers['x-gm-csrf']);
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    return payload;
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    const status = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 503;
    return reply.code(status >= 400 && status < 500 ? status : 503).send({ error: {
      code: status === 400 ? 'invalid_request' : 'home_unavailable',
      message: status === 400 ? 'Check the selected resources and limits.' : 'The home could not complete this operation. Your existing state was preserved.',
    } });
  });
  const human = (request: { ip: string; headers: Record<string, string | string[] | undefined> }) =>
    roles.requireAdministrator(ingressUser(request.ip, request.headers['x-remote-user-id']));
  app.get('/health', async (_request, reply) => reply.code(healthy() ? 200 : 503).send({ ready: healthy(), profile: 'home-assistant-preview' }));
  app.get('/api/session', async request => {
    const user = await human(request); return { name: user.name, csrf: sessions.issue(user.id) };
  });
  app.get('/api/status', async request => { await human(request); return home.status(); });
  app.get('/api/catalog', async request => { await human(request); const resources = await home.catalog(); return { resources, summary: inventorySummary(resources) }; });
  const ids = { type: 'array', minItems: 1, maxItems: 256, uniqueItems: true, items: { type: 'string', pattern: '^r-[a-f0-9]{24}$' } };
  const operationScopes = { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: { enum: capabilities } };
  const object = (properties: object, required: string[]) => ({ type: 'object', additionalProperties: false, properties, required });
  app.post<{ Body: { resources: string[]; minimum: number; maximum: number } }>('/api/setup', {
    schema: { body: object({ resources: ids, minimum: { type: 'number', minimum: 10, maximum: 35 }, maximum: { type: 'number', minimum: 10, maximum: 35 } }, ['resources', 'minimum', 'maximum']) },
  }, async request => { await home.configure(await human(request), request.body.resources, request.body.minimum, request.body.maximum); return home.status(); });
  app.post<{ Body: { name: string; kind: ParticipantKind; resources: string[]; hours: number; capabilities: Capability[] } }>('/api/access', {
    schema: { body: object({ name: { type: 'string', minLength: 1, maxLength: 80 }, kind: { enum: ['person', 'agent', 'machine', 'device', 'service'] },
      resources: ids, capabilities: operationScopes, hours: { type: 'integer', minimum: 1, maximum: 720 } }, ['name', 'kind', 'resources', 'hours', 'capabilities']) },
  }, async request => { await human(request); return home.addMember(request.body.name, request.body.kind, request.body.resources, request.body.hours, request.body.capabilities); });
  app.post<{ Body: { id: string; resources: string[]; hours: number; capabilities: Capability[] } }>('/api/access/update', {
    schema: { body: object({ id: { type: 'string', minLength: 1, maxLength: 80 }, resources: ids, capabilities: operationScopes, hours: { type: 'integer', minimum: 1, maximum: 720 } }, ['id', 'resources', 'hours', 'capabilities']) },
  }, async request => { await human(request); return home.updateMember(request.body.id, request.body.resources, request.body.capabilities, request.body.hours); });
  app.post<{ Body: { id: string } }>('/api/revoke', { schema: { body: object({ id: { type: 'string', minLength: 1, maxLength: 80 } }, ['id']) } },
    async request => { await human(request); await home.revoke(request.body.id); return home.status(); });
  app.post<{ Body: ActionIntent }>('/api/actions', { schema: { body: actionSchema } }, async (request, reply) => {
    const operation = await home.act(await human(request), request.body);
    return reply.code(operation.commandState === 'denied' ? 403 : operation.commandState === 'blocked' ? 503 : operation.commandState === 'outcome_unknown' ? 202 : 200).send(operation);
  });
  const file = (name: string, reply: { type(type: string): unknown }) => {
    const absolute = resolve(webRoot, name);
    const inside = relative(resolve(webRoot), absolute);
    if (inside.startsWith(`..${sep}`) || inside === '..' || resolve(webRoot) === absolute) throw new AppError('not_found', 'File not found.', 404);
    const type = ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(name)];
    if (!type) throw new AppError('not_found', 'File not found.', 404);
    reply.type(type); return readFileSync(absolute);
  };
  app.get('/', async (_request, reply) => file('index.html', reply));
  app.get('/logo.svg', async (_request, reply) => file('logo.svg', reply));
  app.get<{ Params: { '*': string } }>('/assets/*', async (request, reply) => file(`assets/${request.params['*']}`, reply));
  return app;
}
