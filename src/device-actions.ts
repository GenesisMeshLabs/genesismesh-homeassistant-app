/** Finite public adapter definitions. No caller-selected HA domain/service/target. */
export interface ParameterOption { name: string; label: string; type: 'number' | 'select'; minimum?: number; maximum?: number; step?: number; options?: string[] }
export interface ActionOption { capability: string; label: string; parameters: ParameterOption[] }
interface Definition extends ActionOption {
  kinds: string[]; service?: string;
  field?: string; haField?: string; options?: Record<string, string>;
  feature?: number; nativeOptions?: string; nativeRange?: boolean;
}
const choice = (name: string, label: string, options: string[]): ParameterOption => ({ name, label, type: 'select', options });
const number = (name: string, label: string, minimum: number, maximum: number, step = 1): ParameterOption => ({ name, label, type: 'number', minimum, maximum, step });
const power = { on: 'turn_on', off: 'turn_off' };
export const definitions = [
  { capability: 'ha.entity.read', label: 'Read current status', kinds: ['*'], parameters: [] },
  { capability: 'ha.light.set', label: 'Turn light on or off', kinds: ['light'], parameters: [choice('state', 'Power', ['on', 'off'])], field: 'state', options: power },
  { capability: 'ha.light.brightness', label: 'Set light brightness', kinds: ['light'], parameters: [number('brightnessPct', 'Brightness %', 0, 100)], service: 'turn_on', field: 'brightnessPct', haField: 'brightness_pct' },
  { capability: 'ha.climate.set_temperature', label: 'Set heating or cooling temperature', kinds: ['climate'], parameters: [number('temperatureC', 'Temperature °C', -50, 60, 0.5)], service: 'set_temperature', field: 'temperatureC', haField: 'temperature' },
  { capability: 'ha.climate.mode', label: 'Choose heating or cooling mode', kinds: ['climate'], parameters: [choice('mode', 'Mode', ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'])], service: 'set_hvac_mode', field: 'mode', haField: 'hvac_mode', nativeOptions: 'hvac_modes' },
  { capability: 'ha.switch.set', label: 'Turn switch on or off', kinds: ['switch'], parameters: [choice('state', 'Power', ['on', 'off'])], field: 'state', options: power },
  { capability: 'ha.fan.set', label: 'Turn fan on or off', kinds: ['fan'], parameters: [choice('state', 'Power', ['on', 'off'])], field: 'state', options: power },
  { capability: 'ha.fan.speed', label: 'Set fan speed', kinds: ['fan'], parameters: [number('percentage', 'Speed %', 0, 100)], service: 'set_percentage', field: 'percentage', haField: 'percentage', feature: 1 },
  { capability: 'ha.media.transport', label: 'Control playback', kinds: ['media_player'], parameters: [choice('action', 'Playback', ['play', 'pause', 'stop', 'next', 'previous'])], field: 'action', options: { play: 'media_play', pause: 'media_pause', stop: 'media_stop', next: 'media_next_track', previous: 'media_previous_track' } },
  { capability: 'ha.media.volume', label: 'Set media volume', kinds: ['media_player'], parameters: [number('volumePct', 'Volume %', 0, 100)], service: 'volume_set', field: 'volumePct', haField: 'volume_level', feature: 4 },
  { capability: 'ha.media.mute', label: 'Mute or unmute', kinds: ['media_player'], parameters: [choice('state', 'Sound', ['muted', 'unmuted'])], service: 'volume_mute', field: 'state', haField: 'is_volume_muted', feature: 8 },
  { capability: 'ha.media.power', label: 'Turn media player on or off', kinds: ['media_player'], parameters: [choice('state', 'Power', ['on', 'off'])], field: 'state', options: power },
  { capability: 'ha.cover.move', label: 'Open, close or stop blinds', kinds: ['cover'], parameters: [choice('direction', 'Movement', ['open', 'close', 'stop'])], field: 'direction', options: { open: 'open_cover', close: 'close_cover', stop: 'stop_cover' } },
  { capability: 'ha.cover.position', label: 'Set blind position', kinds: ['cover'], parameters: [number('positionPct', 'Open %', 0, 100)], service: 'set_cover_position', field: 'positionPct', haField: 'position', feature: 4 },
  { capability: 'ha.humidifier.set', label: 'Turn humidifier on or off', kinds: ['humidifier'], parameters: [choice('state', 'Power', ['on', 'off'])], field: 'state', options: power },
  { capability: 'ha.humidifier.humidity', label: 'Set target humidity', kinds: ['humidifier'], parameters: [number('humidityPct', 'Humidity %', 1, 100)], service: 'set_humidity', field: 'humidityPct', haField: 'humidity' },
  { capability: 'ha.vacuum.run', label: 'Control vacuum', kinds: ['vacuum'], parameters: [choice('action', 'Vacuum', ['start', 'pause', 'stop', 'return_to_base'])], field: 'action', options: { start: 'start', pause: 'pause', stop: 'stop', return_to_base: 'return_to_base' } },
  { capability: 'ha.helper.boolean', label: 'Turn helper on or off', kinds: ['input_boolean'], parameters: [choice('state', 'Value', ['on', 'off'])], field: 'state', options: power },
  { capability: 'ha.helper.number', label: 'Set numeric value', kinds: ['input_number', 'number'], parameters: [number('value', 'Value', -1e9, 1e9, 0.1)], service: 'set_value', field: 'value', haField: 'value', nativeRange: true },
  { capability: 'ha.helper.select', label: 'Choose an option', kinds: ['input_select', 'select'], parameters: [choice('option', 'Option', [])], service: 'select_option', field: 'option', haField: 'option', nativeOptions: 'options' },
] as const satisfies readonly Definition[];
export type Capability = typeof definitions[number]['capability'];
export const capabilities: readonly Capability[] = definitions.map(d => d.capability);
export const legacyCapabilities: readonly Capability[] = ['ha.climate.set_temperature', 'ha.light.set'];
export const definition = (capability: string): Definition | undefined => definitions.find(d => d.capability === capability) as Definition | undefined;
export const canRead = (kind: string) => !['person', 'device_tracker', 'input_text', 'text'].includes(kind);

export function commandFor(kind: string, capability: string, entityId: string, parameters: Record<string, string | number>) {
  const spec = definition(capability);
  if (!spec || !(spec.kinds.includes(kind) || spec.kinds.includes('*'))) throw new Error('Unsupported action for this domain.');
  if (capability === 'ha.entity.read') {
    if (!canRead(kind)) throw new Error('This domain needs a separate private-data adapter.');
    return { domain: kind, service: '', data: { entity_id: entityId } as Record<string, string | number | boolean> };
  }
  const value = spec.field ? parameters[spec.field] : undefined;
  const service = spec.options ? spec.options[String(value)] : spec.service;
  if (!service) throw new Error('Unsupported finite action.');
  const data: Record<string, string | number | boolean> = { entity_id: entityId };
  if (spec.haField && value !== undefined) data[spec.haField] = capability === 'ha.media.volume' ? Number(value) / 100 : capability === 'ha.media.mute' ? value === 'muted' : value;
  return { domain: kind, service, data };
}

/** Native per-entity features narrow the finite registry; service existence alone isn't support. */
export function operationOptions(kind: string, attributes: Record<string, unknown>, services: Set<string>): ActionOption[] {
  const result: ActionOption[] = [];
  for (const original of definitions) {
    const spec = original as Definition;
    if (!(spec.kinds.includes(kind) || spec.kinds.includes('*'))) continue;
    if (spec.capability === 'ha.entity.read') { if (canRead(kind)) result.push({ capability: spec.capability, label: spec.label, parameters: [] }); continue; }
    if (kind === 'cover' && !['blind', 'shade', 'curtain', 'shutter'].includes(String(attributes['device_class']))) continue;
    const features = typeof attributes['supported_features'] === 'number' ? attributes['supported_features'] : 0;
    if (spec.feature && !(features & spec.feature)) continue;
    if (spec.capability === 'ha.light.brightness' && !(Array.isArray(attributes['supported_color_modes']) && attributes['supported_color_modes'].some(v => typeof v === 'string' && !['onoff', 'unknown'].includes(v)))) continue;
    const parameters: ParameterOption[] = structuredClone(spec.parameters);
    const parameter = parameters[0];
    if (spec.nativeOptions && parameter) {
      const available = attributes[spec.nativeOptions];
      if (!Array.isArray(available)) continue;
      parameter.options = available.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100).slice(0, 128);
      if (spec.capability === 'ha.climate.mode') parameter.options = parameter.options.filter(v => spec.parameters[0]?.options?.includes(v));
      if (!parameter.options.length) continue;
    }
    if (spec.nativeRange && parameter) {
      const min = attributes['min'], max = attributes['max'], step = attributes['step'];
      if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max) || min > max || min < -1e9 || max > 1e9) continue;
      parameter.minimum = min; parameter.maximum = max;
      if (typeof step === 'number' && Number.isFinite(step) && step > 0) parameter.step = step;
    }
    if (spec.capability === 'ha.humidifier.humidity' && parameter) {
      const min = attributes['min_humidity'], max = attributes['max_humidity'];
      if (typeof min === 'number') parameter.minimum = Math.max(1, min);
      if (typeof max === 'number') parameter.maximum = Math.min(100, max);
    }
    if (spec.capability === 'ha.fan.speed' && parameter && typeof attributes['percentage_step'] === 'number' && Number.isFinite(attributes['percentage_step']) && attributes['percentage_step'] > 0) parameter.step = attributes['percentage_step'];
    if (spec.options && parameter?.options) {
      const perOptionFeatures: Record<string, Record<string, number>> = {
        'ha.media.transport': { play: 16384, pause: 1, stop: 4096, next: 32, previous: 16 },
        'ha.media.power': { on: 128, off: 256 },
        'ha.cover.move': { open: 1, close: 2, stop: 8 },
        'ha.vacuum.run': { start: 8192, pause: 4, stop: 8, return_to_base: 16 },
      };
      parameter.options = parameter.options.filter(option => services.has(`${kind}.${spec.options![option]}`) &&
        (!perOptionFeatures[spec.capability] || !!(features & perOptionFeatures[spec.capability]![option]!)));
      if (!parameter.options.length) continue;
    } else if (!services.has(`${kind}.${spec.service}`)) continue;
    result.push({ capability: spec.capability, label: spec.label, parameters });
  }
  return result;
}

export function operationParameterSchema(capability: string) {
  const spec = definition(capability)!;
  const properties = Object.fromEntries(spec.parameters.map(p => [p.name, p.type === 'number'
    ? { type: 'number', minimum: p.minimum, maximum: p.maximum }
    : p.options?.length ? { type: 'string', enum: p.options } : { type: 'string', minLength: 1, maxLength: 100 }]));
  return { type: 'object', additionalProperties: false, properties, required: spec.parameters.map(p => p.name) };
}
