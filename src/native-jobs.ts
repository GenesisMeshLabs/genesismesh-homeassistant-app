import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { credentialDigest } from './identity.js';
import { AppError } from './errors.js';
import type { ManagedHome } from './managed-home.js';
import type { HaUser } from './ha-identity.js';
import type { ActionIntent, Capability, Operation } from './contracts.js';

export interface JobInput { name: string; purpose: 'observer' | 'media'; resources: string[]; capabilities: Capability[]; hours: number; limits?: { maxVolumePct?: number }; includeResource?: boolean }
interface Job extends JobInput {
  id: string; memberId: string; ownerId: string; createdAt: string;
  pairedAt?: string; lastNativeAt?: string; lastVerifiedAt?: string; lastOperationId?: string;
  verification?: ActionIntent;
  pairing?: { digest: string; credential: string; expiresAt: string };
  binding: { entityId: string; registryId?: string; deviceId?: string };
}
const setupUrl = '/config/integrations/dashboard/add?domain=genesismesh';

/** A scoped connection is the actor; an HA automation name is not authentication. */
export class NativeJobs {
  private readonly file: string;
  private jobs: Job[];
  private tail: Promise<unknown> = Promise.resolve();
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(directory: string, private readonly home: ManagedHome) {
    this.file = join(directory, 'native-jobs.json');
    const saved = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { version: 1, jobs: [] };
    if (saved.version !== 1) throw new Error('Unsupported native connection state.');
    this.jobs = saved.jobs;
    if (!Array.isArray(this.jobs)) throw new Error('Invalid native connection state.');
  }
  private save() {
    const next = this.file + '.next'; writeFileSync(next, JSON.stringify({ version: 1, jobs: this.jobs }), { mode: 0o600 });
    const fd = openSync(next, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); } renameSync(next, this.file);
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn); this.tail = result.catch(() => undefined); return result;
  }
  private member(job: Job) { return this.home.status().members.find(member => member.id === job.memberId); }
  private find(id: string) { const job = this.jobs.find(job => job.id === id); if (!job) throw new AppError('job_not_found', 'This job was not found.', 404); return job; }
  forMember(memberId: string) { return this.jobs.find(job => job.memberId === memberId)?.id; }
  private view(job: Job) {
    const member = this.member(job);
    const lastTest = job.lastOperationId ? this.home.journal.get(job.lastOperationId) : undefined;
    const verified = lastTest?.commandState === 'observed' && lastTest.evidenceState === 'acknowledged';
    const connectionState = !member?.enabled ? 'revoked' : Date.parse(member.expiresAt) <= Date.now() ? 'expired'
      : verified ? 'verified' : job.pairedAt ? 'ready_to_test' : 'waiting_for_integration';
    return { id: job.id, memberId: job.memberId, name: job.name, purpose: job.purpose,
      resources: member?.resources ?? [], capabilities: member?.capabilities ?? [], hours: job.hours,
      limits: member?.limits ?? {}, expiresAt: member?.expiresAt, connectionState,
      ...(job.lastNativeAt ? { lastNativeAt: job.lastNativeAt } : {}),
      ...(verified ? { lastVerifiedAt: lastTest.updatedAt } : {}), ...(lastTest ? { lastTest } : {}),
      verificationPending: !!job.verification && Date.parse(job.verification.expiresAt) > Date.now() };
  }
  status() {
    const lastSeenAt = this.jobs.map(job => job.lastNativeAt).filter((v): v is string => !!v).sort().at(-1);
    return { jobs: this.jobs.map(job => this.view(job)), companion: { state: this.jobs.some(job => job.pairedAt) ? 'connected' : 'not_connected', setupUrl, ...(lastSeenAt ? { lastSeenAt } : {}) } };
  }
  async create(user: HaUser, input: JobInput) {
    return this.serial(async () => {
      if (this.jobs.length >= 100) throw new AppError('job_limit', 'End an existing job before adding more.', 409);
      const allowed: Capability[] = input.purpose === 'observer' ? ['ha.entity.read'] : ['ha.entity.read', 'ha.media.transport', 'ha.media.volume'];
      if (input.resources.length !== 1 || !input.capabilities.length || input.capabilities.some(cap => !allowed.includes(cap)) ||
          !input.capabilities.includes('ha.entity.read') || input.purpose === 'media' && !input.capabilities.some(cap => cap !== 'ha.entity.read')) {
        throw new AppError('invalid_job', 'Choose one device and the operations for this job. A safe status read is included for connection verification.');
      }
      const catalog = await this.home.catalog();
      if (input.purpose === 'media' && !catalog.some(r => r.id === input.resources[0] && r.kind === 'media_player')) throw new AppError('invalid_job', 'Choose a supported speaker or television.');
      if (input.capabilities.includes('ha.media.volume') && input.limits?.maxVolumePct === undefined) throw new AppError('invalid_job', 'Choose a maximum volume for this media job.');
      if (!this.home.ready) {
        if (this.home.status().resources.length) throw new AppError('home_needs_review', 'Finish reviewing the existing home settings before creating a job.', 409);
        await this.home.configure(user, input.resources, 19, 23);
      } else if (!this.home.status().resources.some(resource => resource.id === input.resources[0])) {
        if (input.includeResource !== true) throw new AppError('resource_not_eligible', 'This device is not eligible for Mesh. Explicitly review making it eligible before creating the job.', 409);
        const current = this.home.status();
        await this.home.configure(user, [...current.resources.map(r => r.id), input.resources[0]!], current.minimum, current.maximum);
      }
      const member = await this.home.addMember(input.name, 'service', input.resources, input.hours, input.capabilities, input.limits);
      const target = catalog.find(resource => resource.id === input.resources[0])!;
      const job: Job = { ...input, id: `job-${randomUUID()}`, memberId: member.id, ownerId: user.id, createdAt: new Date().toISOString(),
        binding: { entityId: target.entityId, ...(target.registryId ? { registryId: target.registryId } : {}), ...(target.deviceId ? { deviceId: target.deviceId } : {}) } };
      // The first pairing rotates this deliberately undisclosed credential.
      this.jobs.push(job);
      try { this.save(); } catch (error) { this.jobs.pop(); await this.home.revoke(member.id); throw error; }
      return { job: this.view(job) };
    });
  }
  async pairing(id: string) {
    return this.serial(async () => {
      const job = this.find(id), member = this.member(job);
      if (!member?.enabled || Date.parse(member.expiresAt) <= Date.now()) throw new AppError('access_ended', 'Renew or create access before connecting.', 409);
      const credential = await this.home.rotateCredential(job.memberId);
      const code = randomBytes(12).toString('base64url');
      job.pairing = { digest: credentialDigest(code), credential, expiresAt: new Date(Date.now() + 10 * 60000).toISOString() };
      delete job.pairedAt; delete job.lastOperationId; delete job.verification; this.save();
      return { code, expiresAt: job.pairing.expiresAt, baseUrl: this.home.status().connectionGuide.baseUrl, setupUrl };
    });
  }
  async pair(code: string, peer: string, expectedHomeId?: string, expectedJobId?: string) {
    return this.serial(async () => {
      const now = Date.now();
      for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
      if (this.attempts.size >= 1000 && !this.attempts.has(peer)) throw new AppError('pairing_busy', 'Wait before trying to connect again.', 429);
      const attempt = this.attempts.get(peer) ?? { count: 0, until: now + 60000 }; attempt.count++; this.attempts.set(peer, attempt);
      if (attempt.count > 10) throw new AppError('pairing_busy', 'Wait a minute before trying another connection code.', 429);
      const digest = Buffer.from(credentialDigest(code));
      const job = this.jobs.find(j => j.pairing && Date.parse(j.pairing.expiresAt) > now && timingSafeEqual(Buffer.from(j.pairing.digest), digest));
      if (!job?.pairing || !this.member(job)?.enabled) throw new AppError('pairing_expired', 'This code is invalid or expired. Generate a new code in Genesis Mesh.', 401);
      const homeId = this.home.serviceRuntime()!.config.homeId;
      if (expectedHomeId && expectedHomeId !== homeId || expectedJobId && expectedJobId !== job.id) throw new AppError('wrong_job', 'This code belongs to a different home or job. Use the code for this connection.', 409);
      const member = this.member(job)!;
      if (Date.parse(member.expiresAt) <= now) throw new AppError('access_ended', 'This job has expired.', 401);
      const credential = job.pairing.credential;
      delete job.pairing; job.pairedAt = new Date().toISOString(); this.save();
      return { credential, homeId, protocol: 1, jobId: job.id, name: job.name };
    });
  }
  nativeList(memberId: string) {
    const job = this.jobs.find(job => job.memberId === memberId && job.pairedAt);
    if (!job) throw new AppError('native_connection_required', 'This credential is not a paired native connection.', 403);
    const member = this.member(job)!;
    job.lastNativeAt = new Date().toISOString();
    const resources = this.home.status().resources.filter(r => member.resources.includes(r.id)).map(({ id, entityId, name }) => ({ id, entityId, name }));
    return { protocol: 1, jobs: [{ id: job.id, name: job.name, purpose: job.purpose,
      resources, resourceId: resources[0]?.id, entityId: resources[0]?.entityId, capabilities: member.capabilities,
      expiresAt: member.expiresAt, enabled: member.enabled, limits: member.limits,
      allowedHaUserIds: [job.ownerId], allowSystem: true,
      ...(job.verification && Date.parse(job.verification.expiresAt) > Date.now() ? { verification: job.verification } : {}) }] };
  }
  async requestTest(id: string) {
    return this.serial(async () => {
      const job = this.find(id), member = this.member(job);
      if (!job.pairedAt || !member?.enabled || Date.parse(member.expiresAt) <= Date.now()) throw new AppError('native_connection_required', 'Connect the Home Assistant integration before verifying this job.', 409);
      if (!member.capabilities.includes('ha.entity.read') || !member.resources[0]) throw new AppError('read_not_granted', 'This job has no status-read permission. Review its access before testing.', 409);
      if (!job.verification || Date.parse(job.verification.expiresAt) <= Date.now()) job.verification = {
        requestId: randomUUID(), resourceId: member.resources[0], capability: 'ha.entity.read', parameters: {}, expiresAt: new Date(Date.now() + 90000).toISOString() };
      this.save(); return { job: this.view(job) };
    });
  }
  async updateMember(memberId: string, resources: string[], capabilities: Capability[], hours: number, limits?: { maxVolumePct?: number }) {
    return this.serial(async () => {
      const job = this.find(this.forMember(memberId) ?? '');
      const allowed: Capability[] = job.purpose === 'observer' ? ['ha.entity.read'] : ['ha.entity.read', 'ha.media.transport', 'ha.media.volume'];
      if (resources.length !== 1 || resources[0] !== job.resources[0] || !capabilities.includes('ha.entity.read') || capabilities.some(cap => !allowed.includes(cap)) ||
          capabilities.includes('ha.media.volume') && limits?.maxVolumePct === undefined) throw new AppError('native_job_scope', 'Keep this job’s original device and supported operations. Create a new job for a different device.');
      const result = await this.home.updateMember(memberId, resources, capabilities, hours, limits);
      job.hours = hours; job.capabilities = capabilities;
      if (limits) job.limits = limits; else delete job.limits;
      delete job.verification; delete job.lastOperationId; this.save(); return result;
    });
  }
  async execute(memberId: string, id: string, intent: ActionIntent): Promise<Operation> {
    const job = this.find(id);
    if (job.memberId !== memberId || !job.pairedAt) throw new AppError('job_not_found', 'This connection cannot use that job.', 403);
    const target = (await this.home.catalog()).find(resource => resource.id === intent.resourceId);
    if (!target || target.entityId !== job.binding.entityId || target.registryId !== job.binding.registryId ||
        target.deviceId !== job.binding.deviceId) throw new AppError('job_target_changed', 'This device changed or its identity could not be checked. Review the job before using it.', 409);
    const result = await this.home.actParticipant(memberId, intent);
    await this.serial(async () => {
      job.lastNativeAt = new Date().toISOString();
      if (result.commandState === 'observed') job.lastOperationId = result.id;
      if (job.verification?.requestId === intent.requestId) delete job.verification;
      this.save();
    });
    return result;
  }
  async revoke(id: string) {
    const job = this.find(id); await this.home.revoke(job.memberId);
    delete job.pairing; delete job.verification; this.save();
    return { ...this.home.status(), ...this.status() };
  }
}
