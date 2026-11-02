import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { GenesisMeshClient, parseJson, policyDigest, publicKeyFromSeed, seedSigner, type BoundaryPolicyIntent, type BoundaryPolicy } from 'genesis-mesh-sdk';
import type { LocalAuthorityInfo } from './local-authority.js';
import { readSigningSeed } from './secrets.js';
import { credentialDigest } from './identity.js';
import type { ActionIntent, Principal, Resource, RuntimeConfig, ParticipantKind, Capability } from './contracts.js';
import { capabilities, legacyCapabilities, canRead } from './device-actions.js';
import { inventorySummary, type InventoryResource } from './inventory.js';
import { Journal } from './journal.js';
import { Authority } from './authority.js';
import { Executor } from './executor.js';
import { HomeAssistant } from './home-assistant.js';
import { AppError } from './errors.js';
import type { HaUser } from './ha-identity.js';

interface Member { name: string; principal: Principal; haUser?: string; legacyLimited?: boolean }
interface HomeState {
  version: 1; homeId: string; minimum: number; maximum: number; resources: Resource[]; members: Member[];
  expectations: RuntimeConfig['authority']['expectations'];
}

function writePrivate(file: string, value: unknown): void {
  const temporary = `${file}.next`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  const descriptor = openSync(temporary, 'r+');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  renameSync(temporary, file);
}

/** HA-admin controlled application layer; core remains the decision issuer. */
export class ManagedHome {
  private readonly admin: GenesisMeshClient;
  private readonly executorSeed: string;
  readonly journal: Journal;
  private readonly stateFile: string;
  private readonly transition: string;
  private state: HomeState;
  private runtime: { config: RuntimeConfig; executor: Executor } | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private inventoryCache: InventoryResource[] = [];

  constructor(private readonly directory: string, private readonly local: LocalAuthorityInfo,
    private readonly home: HomeAssistant) {
    this.stateFile = join(directory, 'home.json');
    this.transition = join(directory, 'access-transition.json');
    this.admin = new GenesisMeshClient({ baseUrl: local.url, audience: local.publicKey,
      signer: seedSigner(readSigningSeed(local.adminKeyFile), local.adminKeyId), timeout: 5000 });
    const signer = join(directory, 'executor.key');
    if (!existsSync(signer)) writeFileSync(signer, randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' });
    this.executorSeed = readSigningSeed(signer);
    this.journal = new Journal(join(directory, 'journal'));
    this.state = existsSync(this.stateFile) ? parseJson(readFileSync(this.stateFile, 'utf8')) as HomeState : {
      version: 1, homeId: `home-${randomUUID().slice(0, 8)}`, minimum: 19, maximum: 23, resources: [], members: [], expectations: [],
    };
    if (this.state.version !== 1) throw new Error('Unsupported home state.');
    // Missing operation scopes identify the old two-action profile. Never grant new operations during migration.
    for (const member of this.state.members) if (!member.principal.capabilities) {
      member.principal.capabilities = [...legacyCapabilities]; member.legacyLimited = true;
    }
    if (!existsSync(this.stateFile)) writePrivate(this.stateFile, this.state);
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.queued >= 32) return Promise.reject(new AppError('home_busy', 'The home is busy. Wait before sending another request.', 429));
    this.queued++;
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result.finally(() => { this.queued--; });
  }

  async initialize(): Promise<void> {
    const registered = (await this.admin.evidenceStore.listExecutorKeys()).find(k => k.key_id === 'ha-executor');
    const publicKey = publicKeyFromSeed(this.executorSeed);
    if (registered && (registered.public_key !== publicKey || registered.retired_at || registered.resource_prefix !== `ha:${this.state.homeId}/`)) throw new Error('Executor key is not active for this home.');
    if (!registered) await this.admin.evidenceStore.registerExecutorKey({ key_id: 'ha-executor', public_key: publicKey,
      executor_sovereign_id: 'ha-local-executor', resource_prefix: `ha:${this.state.homeId}/` });
    if (this.state.resources.length && !existsSync(this.transition)) this.rebuild();
    await this.catalog().catch(() => undefined);
  }

  get ready(): boolean { return !!this.runtime && !existsSync(this.transition); }

  private rebuild(): void {
    if (!this.state.members.length) { this.runtime = undefined; return; }
    const config: RuntimeConfig = {
      homeId: this.state.homeId, dataDir: join(this.directory, 'journal'),
      authority: { url: this.local.url, publicKey: this.local.publicKey, audience: this.local.publicKey,
        sovereignId: this.local.sovereignId, operatorKeyId: this.local.evaluatorKeyId, operatorKeyFile: this.local.evaluatorKeyFile,
        executorId: 'ha-local-executor', executorKeyId: 'ha-executor', executorKeyFile: join(this.directory, 'executor.key'),
        expectations: this.state.expectations },
      homeAssistant: { url: 'http://supervisor/core/api', tokenFile: 'environment:SUPERVISOR_TOKEN' },
      resources: this.state.resources, principals: this.state.members.map(m => m.principal),
    };
    const authority = new Authority(config, this.journal, readSigningSeed(this.local.evaluatorKeyFile), this.executorSeed);
    this.runtime = { config, executor: new Executor(config, this.journal, authority, this.home) };
  }

  serviceRuntime() { return this.ready ? { ...this.runtime!, journal: this.journal } : undefined; }

  async catalog(): Promise<InventoryResource[]> { this.inventoryCache = await this.home.catalog(); return this.inventoryCache; }

  status() {
    return { ready: this.ready, minimum: this.state.minimum, maximum: this.state.maximum,
      resources: this.state.resources.map(resource => this.inventoryCache.find(r => r.id === resource.id) ?? { ...resource, state: 'Not checked', available: false,
        operations: [], readable: canRead(resource.kind), reason: 'Refresh Devices to check current status and supported controls.' }),
      members: this.state.members.map(m => ({ id: m.principal.id, name: m.name, kind: m.principal.kind,
        resources: m.principal.resources, enabled: m.principal.enabled, expiresAt: m.principal.expiresAt, nativeUser: !!m.haUser,
        capabilities: m.principal.capabilities ?? [...legacyCapabilities], legacyLimited: !!m.legacyLimited })),
      summary: inventorySummary(this.inventoryCache),
      activity: this.journal.latest(50),
      custody: 'Local authority and signing keys are stored in this app’s private data. Backups contain those keys.',
      needsRecovery: existsSync(this.transition) || (this.state.resources.length > 0 && !this.state.expectations.some(e => e.capability === 'ha.entity.read')) };
  }

  private async issue(id: string, kind: ParticipantKind, resources: string[], hours: number, granted: Capability[]): Promise<Principal> {
    const attestation = await this.admin.attestation.issue({ subject_id: id, roles: ['role:client'], validity_hours: hours,
      claims: { capabilities: granted, resources } });
    return { id, kind, resources, enabled: true, attestationId: attestation.attestation_id,
      credentialSha256: credentialDigest(randomBytes(32).toString('base64url')),
      expiresAt: new Date(Date.now() + hours * 3600000).toISOString(), capabilities: granted };
  }

  private async ensureHuman(user: HaUser): Promise<Principal> {
    let member = this.state.members.find(m => m.haUser === user.id);
    const resources = this.state.resources.map(r => r.id);
    const granted = [...new Set(this.inventoryCache.filter(r => resources.includes(r.id)).flatMap(r => r.operations.map(op => op.capability as Capability)))];
    if (!granted.length) throw new AppError('home_unavailable', 'Refresh device availability before trying a request.', 503);
    if (member && member.principal.enabled && Date.parse(member.principal.expiresAt) > Date.now() + 60000 &&
        resources.join(',') === member.principal.resources.join(',') && granted.join(',') === member.principal.capabilities?.join(',')) return member.principal;
    if (member) await this.admin.attestation.revoke(member.principal.attestationId, { reason: 'HA administrator access renewed' });
    const principal = await this.issue(`person-${user.id}`.slice(0, 80), 'person', resources, 24, granted);
    if (member) { member.principal = principal; member.name = user.name; }
    else { member = { name: user.name, principal, haUser: user.id }; this.state.members.push(member); }
    writePrivate(this.stateFile, this.state);
    this.rebuild();
    return principal;
  }

  async configure(user: HaUser, resourceIds: string[], minimum: number, maximum: number): Promise<void> {
    return this.exclusive(async () => {
      const catalog = await this.catalog();
      const selected = catalog.filter(r => resourceIds.includes(r.id));
      if (!selected.length || selected.length !== resourceIds.length || selected.some(r => !r.operations.length) || !Number.isFinite(minimum) || !Number.isFinite(maximum) ||
          minimum < 10 || maximum > 35 || minimum > maximum) throw new AppError('invalid_access', 'Choose supported resources and a temperature range between 10 and 35 °C.');
      writePrivate(this.transition, { startedAt: new Date().toISOString() });
      this.runtime = undefined;
      this.state.resources = selected.map(({ id, name, kind, entityId }) => ({ id, name, kind, entityId }));
      this.state.minimum = minimum; this.state.maximum = maximum;
      const period = { valid_from: new Date(Date.now() - 60000).toISOString(), valid_until: new Date(Date.now() + 365 * 86400000).toISOString() };
      const intents: BoundaryPolicyIntent[] = [
        { policy_id: 'gmha-home', description: 'Home and participant resource scope', ...period,
          selector: { capabilities: ['ha.*'] }, gates: [
            { gate_id: 'home', gate_type: 'allowlist.v1', order: 0, config: { path: 'request_parameters.home_id', values: [this.state.homeId] } },
            { gate_id: 'resource', gate_type: 'attestation_claim.v1', order: 1, config: { path: 'request_parameters.resource_id', claim: 'resources' } },
          ] },
        { policy_id: 'gmha-temperature', description: 'Delegated Celsius setpoint range', ...period,
          selector: { capabilities: ['ha.climate.set_temperature'] }, gates: [
            { gate_id: 'minimum', gate_type: 'min_value.v1', order: 0, config: { path: 'request_parameters.temperature_c', min: minimum } },
            { gate_id: 'maximum', gate_type: 'max_value.v1', order: 1, config: { path: 'request_parameters.temperature_c', max: maximum } },
          ] },
        { policy_id: 'gmha-light', description: 'Explicit light state', ...period,
          selector: { capabilities: ['ha.light.set'] }, gates: [
            { gate_id: 'state', gate_type: 'allowlist.v1', order: 0, config: { path: 'request_parameters.state', values: ['on', 'off'] } },
          ] },
      ];
      const signed: BoundaryPolicy[] = [];
      for (const intent of intents) {
        const policy = await this.admin.policy.publish(intent); await this.admin.policy.activate(policy.policy_id, policy.version); signed.push(policy);
      }
      this.state.expectations = capabilities.map(capability => ({ capability,
        policies: signed.filter(p => p.policy_id === 'gmha-home' || (capability === 'ha.climate.set_temperature' && p.policy_id === 'gmha-temperature') || (capability === 'ha.light.set' && p.policy_id === 'gmha-light'))
          .map(p => ({ id: p.policy_id, version: p.version, digest: policyDigest(p) })) }));
      for (const member of this.state.members) member.principal.resources = member.principal.resources.filter(id => resourceIds.includes(id));
      await this.ensureHuman(user);
      writePrivate(this.stateFile, this.state);
      unlinkSync(this.transition);
      this.rebuild();
    });
  }

  private async checkScope(resources: string[], granted: Capability[], hours: number): Promise<void> {
    if (!this.ready || !resources.length || resources.length > 256 || new Set(resources).size !== resources.length ||
        resources.some(id => !this.state.resources.some(r => r.id === id)) || !granted.length || new Set(granted).size !== granted.length ||
        granted.some(cap => !capabilities.includes(cap)) || !Number.isInteger(hours) || hours < 1 || hours > 720) throw new AppError('invalid_access', 'Choose shared resources, explicit operations and an expiry from 1 hour to 30 days.');
    const catalog = await this.catalog();
    if (resources.some(id => !catalog.some(r => r.id === id && r.operations.some(op => granted.includes(op.capability as Capability)))) ||
        granted.some(cap => !catalog.some(r => resources.includes(r.id) && r.operations.some(op => op.capability === cap)))) throw new AppError('unsupported_scope', 'One of the selected operations is no longer supported. Refresh Devices and review access.');
  }

  async addMember(name: string, kind: ParticipantKind, resources: string[], hours: number, requested?: Capability[]) {
    return this.exclusive(async () => {
      const granted = requested ?? [...new Set(this.state.resources.filter(r => resources.includes(r.id) && ['light', 'climate'].includes(r.kind)).map(r => r.kind === 'climate' ? 'ha.climate.set_temperature' as const : 'ha.light.set' as const))];
      await this.checkScope(resources, granted, hours);
      if (this.state.members.length >= 128) throw new AppError('access_limit', 'This preview supports at most 128 access profiles.');
      const principal = await this.issue(`${kind}-${randomUUID()}`, kind, resources, hours, granted);
      const credential = randomBytes(32).toString('base64url'); principal.credentialSha256 = credentialDigest(credential);
      this.state.members.push({ name, principal }); writePrivate(this.stateFile, this.state);
      this.rebuild();
      return { id: principal.id, credential, expiresAt: principal.expiresAt };
    });
  }

  async updateMember(id: string, resources: string[], granted: Capability[], hours: number) {
    return this.exclusive(async () => {
      await this.checkScope(resources, granted, hours);
      const member = this.state.members.find(m => m.principal.id === id && !m.haUser);
      if (!member) throw new AppError('access_not_found', 'Access profile not found.', 404);
      const previous = member.principal;
      member.principal.enabled = false; writePrivate(this.stateFile, this.state); this.rebuild();
      await this.admin.attestation.revoke(previous.attestationId, { reason: 'Access scope explicitly updated by a Home Assistant administrator' });
      const replacement = await this.issue(previous.id, previous.kind, resources, hours, granted);
      replacement.credentialSha256 = previous.credentialSha256;
      member.principal = replacement; member.legacyLimited = false;
      writePrivate(this.stateFile, this.state); this.rebuild();
      return { id: replacement.id, expiresAt: replacement.expiresAt };
    });
  }

  async revoke(id: string): Promise<void> {
    return this.exclusive(async () => {
      const member = this.state.members.find(m => m.principal.id === id && !m.haUser);
      if (!member) throw new AppError('access_not_found', 'Access profile not found.', 404);
      await this.admin.attestation.revoke(member.principal.attestationId, { reason: 'Access ended by a Home Assistant administrator' });
      member.principal.enabled = false; writePrivate(this.stateFile, this.state);
      this.rebuild();
    });
  }

  async act(user: HaUser, intent: ActionIntent) {
    return this.exclusive(async () => {
      if (!this.ready) throw new AppError('setup_required', 'Finish choosing resources before trying an action.', 409);
      const principal = await this.ensureHuman(user);
      return this.runtime!.executor.execute(principal, intent);
    });
  }

  async actParticipant(id: string, intent: ActionIntent) {
    return this.exclusive(async () => {
      const principal = this.state.members.find(m => m.principal.id === id)?.principal;
      if (!this.ready || !principal || !principal.enabled || Date.now() >= Date.parse(principal.expiresAt)) {
        throw new AppError('access_ended', 'This access is no longer available.', 403);
      }
      return this.runtime!.executor.execute(principal, intent);
    });
  }

  async flush() { return this.exclusive(async () => { if (this.runtime) await this.runtime.executor.flush(); }); }
  async close() { await this.tail; await this.runtime?.executor.idle(); this.journal.close(); }
}
