import { parseJson } from 'genesis-mesh-sdk';
import type { CompiledAction } from './contracts.js';
import { endpoint } from './config.js';
import { AppError } from './errors.js';
import { canonicalDigest } from 'genesis-mesh-sdk';
import type { Resource } from './contracts.js';

export interface HomeExecutor {
  preflight(action: CompiledAction): Promise<void>;
  dispatch(action: CompiledAction): Promise<'accepted' | 'outcome_unknown'>;
}

async function boundedJson(response: Response, limit = 65536): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty HA response.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new Error('HA response exceeds the adapter limit.');
      chunks.push(part.value);
    }
    return parseJson(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Finite HA REST adapter. No arbitrary services, URLs, templates or command replay. */
export class HomeAssistant implements HomeExecutor {
  private readonly base: string;
  constructor(url: string, private readonly token: string, private readonly fetcher = globalThis.fetch, profile: 'standalone' | 'supervisor' = 'standalone') {
    this.base = profile === 'supervisor' && url === 'http://supervisor/core/api' ? url : endpoint(url);
    if (!token || /\s/.test(token)) throw new Error('A valid Home Assistant credential file is required.');
  }

  async catalog(): Promise<Resource[]> {
    const response = await this.fetcher(this.base + '/states', {
      headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new AppError('home_unavailable', 'Home Assistant could not list supported resources.', 503);
    const result = await boundedJson(response, 2 * 1024 * 1024);
    if (!Array.isArray(result)) throw new AppError('home_unavailable', 'Home Assistant returned an invalid catalog.', 503);
    return result.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .filter(item => typeof item['entity_id'] === 'string' && /^(light|climate)\.[a-z0-9_]+$/.test(item['entity_id']))
      .slice(0, 256).map(item => {
        const entityId = String(item['entity_id']);
        const attributes = item['attributes'] as Record<string, unknown> | undefined;
        return { id: `r-${canonicalDigest(entityId).slice(0, 24)}`, entityId,
          kind: entityId.startsWith('climate.') ? 'climate' : 'light',
          name: String(attributes?.['friendly_name'] ?? entityId).slice(0, 200) };
      });
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    const response = await this.fetcher(this.base + path, {
      headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error('HA read did not complete.');
    const result = await boundedJson(response);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('HA response is not an object.');
    return result as Record<string, unknown>;
  }

  async preflight(action: CompiledAction): Promise<void> {
    try {
      const state = await this.get(`/states/${encodeURIComponent(action.resource.entityId)}`);
      if (state['entity_id'] !== action.resource.entityId || typeof state['state'] !== 'string' ||
          ['unknown', 'unavailable'].includes(state['state'])) throw new Error('Target is unavailable.');
      if (action.command.domain === 'climate') {
        const config = await this.get('/config');
        const unit = config['unit_system'] as Record<string, unknown> | undefined;
        if (unit?.['temperature'] !== '°C') throw new AppError('unsupported_unit', 'This preview supports Celsius Home Assistant installations only.');
        const attributes = state['attributes'] as Record<string, unknown> | undefined;
        const minimum = attributes?.['min_temp'], maximum = attributes?.['max_temp'];
        const requested = action.command.data['temperature'];
        if (typeof minimum !== 'number' || !Number.isFinite(minimum) || typeof maximum !== 'number' || !Number.isFinite(maximum) ||
            typeof requested !== 'number' || requested < minimum || requested > maximum) {
          throw new AppError('unsupported_setpoint', 'The requested temperature is outside the device-supported range.');
        }
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('home_unavailable', 'The selected home device could not be checked. No action was sent.', 503);
    }
  }

  async dispatch(action: CompiledAction): Promise<'accepted' | 'outcome_unknown'> {
    try {
      const response = await this.fetcher(`${this.base}/services/${action.command.domain}/${action.command.service}`, {
        method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(action.command.data), redirect: 'error', signal: AbortSignal.timeout(3000),
      });
      await response.body?.cancel();
      // Even an HA error can follow a partial effect. Never blindly re-send.
      return response.ok ? 'accepted' : 'outcome_unknown';
    } catch {
      return 'outcome_unknown';
    }
  }
}
