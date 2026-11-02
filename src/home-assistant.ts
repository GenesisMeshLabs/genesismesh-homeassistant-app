import { parseJson } from 'genesis-mesh-sdk';
import type { CompiledAction } from './contracts.js';
import { endpoint } from './config.js';
import { AppError } from './errors.js';
import type { Observation } from './contracts.js';
import { inventory, observeState, serviceSet, type InventoryResource } from './inventory.js';
import { operationOptions } from './device-actions.js';

export interface HomeExecutor {
  preflight(action: CompiledAction): Promise<void>;
  dispatch(action: CompiledAction): Promise<'accepted' | 'outcome_unknown'>;
  observe?(action: CompiledAction): Promise<Observation>;
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

  private async services(): Promise<Set<string>> {
    const response = await this.fetcher(this.base + '/services', { headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new AppError('home_unavailable', 'Home Assistant could not confirm available device controls.', 503);
    return serviceSet(await boundedJson(response, 2 * 1024 * 1024));
  }

  async catalog(): Promise<InventoryResource[]> {
    const response = await this.fetcher(this.base + '/states', {
      headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new AppError('home_unavailable', 'Home Assistant could not list supported resources.', 503);
    const result = await boundedJson(response, 16 * 1024 * 1024);
    // Inventory still explains read-only coverage when the action catalog is unavailable.
    const services = await this.services().catch(() => new Set<string>());
    return inventory(result, services);
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
      if (action.capability === 'ha.entity.read') return;
      const state = await this.get(`/states/${encodeURIComponent(action.resource.entityId)}`);
      if (state['entity_id'] !== action.resource.entityId || typeof state['state'] !== 'string' ||
          ['unknown', 'unavailable'].includes(state['state'])) throw new Error('Target is unavailable.');
      const attrs = state['attributes'] && typeof state['attributes'] === 'object' && !Array.isArray(state['attributes']) ? state['attributes'] as Record<string, unknown> : {};
      const operation = operationOptions(action.resource.kind, attrs, await this.services()).find(op => op.capability === action.capability);
      if (!operation) throw new AppError('unsupported_action', 'This device does not currently advertise the requested control. No command was sent.');
      for (const parameter of operation.parameters) {
        const key = parameter.name === 'temperatureC' ? 'temperature_c' : parameter.name;
        const value = action.parameters[key];
        if (parameter.type === 'select' && !parameter.options?.includes(String(value))) throw new AppError('unsupported_option', 'This device no longer supports the selected option.');
        if (parameter.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < parameter.minimum! || value > parameter.maximum!)) throw new AppError('unsupported_range', 'The requested value is outside the device-supported range.');
        const nativeStep = action.capability === 'ha.helper.number' ? attrs['step'] : action.capability === 'ha.fan.speed' ? attrs['percentage_step'] : undefined;
        if (typeof value === 'number' && typeof nativeStep === 'number' && Number.isFinite(nativeStep) && nativeStep > 0 &&
            value !== parameter.maximum && Math.abs((value - (parameter.minimum ?? 0)) / nativeStep - Math.round((value - (parameter.minimum ?? 0)) / nativeStep)) > 1e-6) {
          throw new AppError('unsupported_step', 'Choose a value aligned with the device-supported step.');
        }
      }
      if (action.capability === 'ha.climate.set_temperature') {
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

  async observe(action: CompiledAction): Promise<Observation> {
    return observeState(action.resource, await this.get(`/states/${encodeURIComponent(action.resource.entityId)}`));
  }

  async dispatch(action: CompiledAction): Promise<'accepted' | 'outcome_unknown'> {
    if (action.capability === 'ha.entity.read') throw new AppError('unsupported_action', 'Status reads cannot dispatch device commands.');
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
