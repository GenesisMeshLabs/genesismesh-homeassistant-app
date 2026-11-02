export interface Parameter { name: string; label: string; type: 'number' | 'select'; minimum?: number; maximum?: number; step?: number; options?: string[] }
export interface ActionOption { capability: string; label: string; parameters: Parameter[] }
export interface Resource {
  id: string; name: string; entityId: string; kind: string; state: string; available: boolean;
  operations: ActionOption[]; readable: boolean; reason?: string; deviceId?: string; deviceName?: string; area?: string;
}
export interface Summary { total: number; returned?: number; truncated?: boolean; controllable: number; readable: number; domains: Record<string, number> }
export interface Member {
  id: string; name: string; kind: string; resources: string[]; capabilities: string[];
  enabled: boolean; expiresAt: string; nativeUser: boolean; legacyLimited: boolean;
}
export interface Observation { state: string; attributes: Record<string, unknown>; observedAt: string }
export interface Operation {
  id: string; requestId: string; subjectId: string; resourceId: string; capability: string; commandState: string;
  evidenceState: string; reason: string; createdAt: string; policyFailures: string[]; observation?: Observation;
}
export interface Status { ready: boolean; needsRecovery: boolean; minimum: number; maximum: number; resources: Resource[]; members: Member[]; activity: Operation[]; custody: string }
export const readCapability = 'ha.entity.read';
const kindNames: Record<string, string> = { light: 'Lights', switch: 'Switches & plugs', fan: 'Fans', climate: 'Heating & cooling', media_player: 'TVs & speakers', cover: 'Blinds & covers', sensor: 'Sensors', binary_sensor: 'Status sensors', scene: 'Scenes', vacuum: 'Vacuums', humidifier: 'Humidifiers', input_boolean: 'On/off helpers', input_number: 'Number helpers', number: 'Number controls', input_select: 'Selection helpers', select: 'Selection controls', todo: 'To-do lists' };
export const kindLabel = (kind: string) => kindNames[kind] ?? kind.replaceAll('_', ' ');
export const hasControl = (resource: Resource) => resource.operations.some(op => op.capability !== readCapability);
export const canShare = (resource: Resource) => resource.operations.length > 0;
export const stateLabel = (state: string) => state.replaceAll('_', ' ').slice(0, 200);
export const commandLabel = (state: string) => ({ observed: 'State observed. No device command was sent.', accepted: 'Home Assistant accepted the command. Physical result is unconfirmed.', denied: 'Access rule refused the request. No command was sent.', blocked: 'The request stopped before dispatch.', outcome_unknown: 'The result is unknown. Check the device before another request.' } as Record<string, string>)[state] ?? state.replaceAll('_', ' ');
