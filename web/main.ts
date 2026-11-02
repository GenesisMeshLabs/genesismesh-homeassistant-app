import { LitElement, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { styles } from './components/styles.js';
import { accessState, usageLabel, requestExplanation, recordLabel } from './components/experience.js';
import { canShare, commandLabel, hasControl, kindLabel, readCapability, stateLabel,
  type ActionOption, type Member, type Operation, type Resource, type Status, type Summary } from './components/models.js';

class GenesisHome extends LitElement {
  static override properties = {
    status: { state: true }, catalog: { state: true }, summary: { state: true }, page: { state: true }, busy: { state: true },
    message: { state: true }, feedback: { state: true }, secret: { state: true }, name: { state: true }, selected: { state: true }, outcome: { state: true },
    search: { state: true }, domain: { state: true }, coverage: { state: true }, grantResources: { state: true },
    grantCapabilities: { state: true }, visibleCount: { state: true }, template: { state: true }, editMember: { state: true }, volumeLimit: { state: true },
  };
  declare private status: Status | undefined;
  declare private catalog: Resource[]; declare private summary: Summary | undefined;
  declare private page: string; declare private busy: boolean; declare private message: string;
  declare private feedback: string; declare private secret: string; declare private name: string; declare private selected: string[];
  declare private outcome: Operation | undefined; declare private search: string; declare private domain: string;
  declare private coverage: string; declare private grantResources: string[]; declare private grantCapabilities: string[];
  declare private visibleCount: number; declare private template: string; declare private editMember: Member | undefined;
  declare private volumeLimit: string;
  private secretScope: { resources: Resource[]; capabilities: string[] } | undefined;
  private csrf = '';
  static override styles = styles;

  constructor() {
    super(); this.catalog = []; this.page = 'home'; this.busy = false; this.message = ''; this.feedback = ''; this.secret = ''; this.name = '';
    this.selected = []; this.search = ''; this.domain = ''; this.coverage = ''; this.grantResources = [];
    this.grantCapabilities = []; this.template = 'custom'; this.visibleCount = 100; this.volumeLimit = '';
  }
  override connectedCallback() { super.connectedCallback(); void this.refresh(); }
  private async api(path: string, body?: unknown): Promise<any> {
    const response = await fetch(new URL(`api/${path}`, document.baseURI), { credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GM-CSRF': this.csrf }, body: JSON.stringify(body) }) });
    const value = await response.json();
    if (!response.ok && !value.commandState) throw new Error(value.error?.message ?? 'The home could not complete the request.');
    return value;
  }
  private async refresh() {
    this.busy = true; this.message = ''; this.feedback = '';
    try { const session = await this.api('session'); this.csrf = session.csrf; this.name = session.name; await this.load(); }
    catch (error) { this.message = error instanceof Error ? error.message : 'The home is unavailable.'; }
    finally { this.busy = false; }
  }
  private async load() {
    const catalog = await this.api('catalog'); this.catalog = catalog.resources; this.summary = catalog.summary;
    this.status = await this.api('status');
    if (!this.status!.ready || this.status!.needsRecovery) this.selected = this.status!.resources.map(r => r.id);
  }
  private async work(action: () => Promise<void>) {
    this.busy = true; this.message = ''; this.feedback = '';
    try { await action(); await this.load(); }
    catch (error) { this.message = error instanceof Error ? error.message : 'The home is unavailable. Review Activity before another request.'; }
    finally { this.busy = false; }
  }
  private navigate(page: string) { this.page = page; this.message = ''; this.feedback = ''; if (page === 'activity') void this.refresh(); }
  private beginSharing() {
    this.selected = this.status!.resources.map(r => r.id); this.search = ''; this.domain = ''; this.coverage = ''; this.navigate('setup');
  }
  private toggle(values: string[], id: string, checked: boolean) { return checked ? [...new Set([...values, id])] : values.filter(value => value !== id); }
  private filters() {
    return html`<div class="filters">
      <label class="field search">Find a device or entity<input type="search" .value=${this.search} placeholder="Search by name or type" @input=${(e: Event) => { this.search = (e.target as HTMLInputElement).value; }}></label>
      <label class="field">Device type<select aria-label="Device type" .value=${this.domain} @change=${(e: Event) => { this.domain = (e.target as HTMLSelectElement).value; }}><option value="">All types</option>${[...new Set(this.catalog.map(r => r.kind))].sort().map(kind => html`<option value=${kind}>${kindLabel(kind)}</option>`)}</select></label>
      <label class="field">Show<select aria-label="Show" .value=${this.coverage} @change=${(e: Event) => { this.coverage = (e.target as HTMLSelectElement).value; }}><option value="">Everything</option><option value="control">Can control</option><option value="read">Read only</option><option value="inventory">Inventory only</option><option value="shared">Shared through Mesh</option><option value="unavailable">Unavailable</option></select></label>
    </div>`;
  }
  private filteredResources() {
    const search = this.search.trim().toLocaleLowerCase(); const shared = new Set(this.status!.resources.map(r => r.id));
    return this.catalog.filter(r => (!this.domain || r.kind === this.domain) &&
      (!search || [r.name, r.entityId, r.deviceName ?? '', r.area ?? '', kindLabel(r.kind)].join(' ').toLocaleLowerCase().includes(search)) &&
      (!this.coverage || this.coverage === 'control' && hasControl(r) || this.coverage === 'read' && r.readable && !hasControl(r) ||
        this.coverage === 'inventory' && !canShare(r) || this.coverage === 'shared' && shared.has(r.id) || this.coverage === 'unavailable' && !r.available));
  }
  private inventoryPager(total: number) { return total > this.visibleCount ? html`<p class="hint">Showing ${this.visibleCount} of ${total} matches. Search or filter to narrow the list.</p><button type="button" @click=${() => { this.visibleCount += 100; }}>Show next 100 entities</button>` : nothing; }
  private selectMatching(add: boolean) {
    const matching = this.filteredResources().filter(canShare).map(resource => resource.id);
    if (!add) { this.selected = this.selected.filter(id => !matching.includes(id)); this.feedback = 'Matching resources were removed from this selection. Save to apply it.'; return; }
    const additions = matching.filter(id => !this.selected.includes(id));
    const capacity = Math.max(0, 256 - this.selected.length);
    this.selected = [...this.selected, ...additions.slice(0, capacity)];
    this.feedback = additions.length > capacity ? `Selected ${capacity} of ${additions.length} new matches. This preview can share 256 resources; narrow the filter or clear other selections.` : `${additions.length} matching resources added. Review the selection, then save to apply it.`;
  }
  private badges(resource: Resource, shared = false) {
    return html`<div class="badges"><span class="badge">${kindLabel(resource.kind)}</span><span class="badge ${canShare(resource) ? '' : 'muted'}">${hasControl(resource) ? 'Control available' : resource.readable ? 'Read only' : 'Inventory only'}</span>
      ${shared ? html`<span class="badge">Shared through Mesh</span>` : nothing}${!resource.available ? html`<span class="badge warning">${resource.state === 'unknown' ? 'State unknown' : 'Unavailable'}</span>` : nothing}</div>`;
  }
  private inventorySummary() {
    return html`<div class="metrics"><div class="metric"><strong>${this.summary?.total ?? this.catalog.length}</strong><span>entities discovered</span></div><div class="metric"><strong>${this.summary?.controllable ?? this.catalog.filter(hasControl).length}</strong><span>with controls</span></div><div class="metric"><strong>${this.summary?.readable ?? this.catalog.filter(r => r.readable).length}</strong><span>can be observed</span></div></div>`;
  }
  private setup() {
    const filtered = this.filteredResources(); const heating = this.catalog.some(r => this.selected.includes(r.id) && r.kind === 'climate');
    return html`<p class="eyebrow">1 · Choose what can be shared</p><h1>Your whole home, in view.</h1><p class="page-description">Browse everything Home Assistant exposes. Choose which entities may be used through Genesis Mesh. Sensors can provide observations; supported controls can accept bounded requests.</p>
      ${this.status?.needsRecovery ? html`<p class="notice">Review sharing to finish this update. Check the selected resources and save. Existing keys and client credentials are preserved; participant access is not broadened automatically.</p>` : nothing}${this.inventorySummary()}
      <form @submit=${(event: Event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); void this.work(async () => { await this.api('setup', { resources: this.selected, minimum: Number(data.get('minimum') ?? this.status!.minimum), maximum: Number(data.get('maximum') ?? this.status!.maximum) }); this.navigate('access'); }); }}>
        ${this.filters()}<section class="card"><div class="row"><h2>Choose what to share</h2><span class="count">${this.selected.length} selected</span></div><p class="hint">New discoveries stay unshared. Existing access profiles keep their current scope.</p><div class="actions"><button type="button" ?disabled=${this.busy || this.selected.length >= 256} @click=${() => this.selectMatching(true)}>Select matching shareable items</button><button type="button" ?disabled=${this.busy || !this.selected.length} @click=${() => this.selectMatching(false)}>Clear matching selection</button></div>
          ${filtered.length ? filtered.slice(0, this.visibleCount).map(r => html`<label class="pick ${canShare(r) ? '' : 'disabled'}"><input type="checkbox" aria-label=${`Share ${r.name}`} .checked=${this.selected.includes(r.id)} ?disabled=${this.busy || !canShare(r) || this.selected.length >= 256 && !this.selected.includes(r.id)} @change=${(e: Event) => { this.selected = this.toggle(this.selected, r.id, (e.target as HTMLInputElement).checked); }}><span><strong>${r.name}</strong>${r.area ? html`<br><small>${r.area}</small>` : nothing}${this.badges(r)}${r.reason ? html`<small>${r.reason}</small>` : nothing}</span></label>`) : html`<p class="empty">No matches. Try another name or type.</p>`}
          <p class="hint">Showing ${Math.min(filtered.length, this.visibleCount)} of ${filtered.length} matching entities, from ${this.catalog.length} entities. A physical device may have several entities. Up to 256 can be shared.</p>${this.inventoryPager(filtered.length)}</section>
        ${heating ? html`<section class="card"><h2>Heating limits</h2><p>Delegated Celsius setpoints must stay inside these bounds and the device’s own limits.</p><div class="ranges"><label class="field">Minimum °C<input name="minimum" type="number" min="10" max="35" step="0.5" .value=${String(this.status?.minimum ?? 19)} required></label><label class="field">Maximum °C<input name="maximum" type="number" min="10" max="35" step="0.5" .value=${String(this.status?.maximum ?? 23)} required></label></div></section>` : nothing}
        <button class="primary" ?disabled=${this.busy || !this.selected.length}>Save sharing selection</button>${this.status!.ready ? html`<button type="button" ?disabled=${this.busy} @click=${() => this.navigate('devices')}>Cancel</button>` : nothing}<p class="hint">Saving makes these resources available for explicit access profiles. It does not operate a device or grant new permissions to an existing participant.</p>
      </form>`;
  }
  private devices() {
    const filtered = this.filteredResources(); const shared = new Set(this.status!.resources.map(r => r.id));
    return html`<div class="row"><div><p class="eyebrow">Your devices & entities</p><h1>See where everything fits.</h1></div><div class="actions"><button ?disabled=${this.busy} @click=${() => { void this.refresh(); }}>Refresh devices</button><button class="primary" ?disabled=${this.busy} @click=${() => this.beginSharing()}>Change shared devices</button></div></div><p class="page-description">Every discovered entity type appears here. Sharing and access are separate: a participant needs both selected resources and permitted operations.</p>${this.inventorySummary()}${this.filters()}<p class="count">${filtered.length} matching entities · ${shared.size} shared</p>
      <div class="inventory-list">${repeat(filtered.slice(0, this.visibleCount), r => r.id, r => html`<article class="card"><div class="row"><h2 class="device-title">${r.name}</h2><span>${stateLabel(r.state)}</span></div>${r.area || r.deviceName ? html`<p class="hint">${[r.area, r.deviceName].filter(Boolean).join(' · ')}</p>` : nothing}${this.badges(r, shared.has(r.id))}${r.reason ? html`<p class="hint">${r.reason}</p>` : nothing}
        ${shared.has(r.id) ? this.deviceRequests(r) : html`<p class="hint">Not shared through Mesh. ${canShare(r) ? 'Choose Change shared devices to make it available for access profiles.' : 'Its current adapter does not offer delegated reads or controls.'}</p>`}<details><summary>Entity reference</summary><code>${r.entityId}</code><p class="hint">Discovery does not enroll the physical device as a Genesis Mesh node.</p></details></article>`)}</div>${this.inventoryPager(filtered.length)}${!filtered.length ? html`<p class="empty">No matches. Clear a filter to see more of your home.</p>` : nothing}`;
  }
  private deviceRequests(resource: Resource) {
    return html`<details><summary>Try a request as ${this.name}</summary><p class="hint">Read requests observe state. Control requests below operate this device and use your current administrator identity.</p>
      ${resource.operations.map(op => html`<section class="operation"><h3>${op.label}</h3><form @submit=${(event: Event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; if (!form.reportValidity()) return; const data = new FormData(form); const parameters: Record<string, string | number> = {}; for (const parameter of op.parameters) { const value = String(data.get(parameter.name) ?? '').trim(); if (!value) { this.message = 'Choose each requested value before sending a control request.'; return; } parameters[parameter.name] = parameter.type === 'number' ? Number(value) : value; } this.run(resource, op, parameters); }}>
        ${op.parameters.map(parameter => html`<label class="field">${parameter.label}${parameter.type === 'number' ? html`<input aria-label=${parameter.label} name=${parameter.name} type="number" min=${op.capability === 'ha.climate.set_temperature' ? Math.max(parameter.minimum ?? -50, this.status!.minimum) : parameter.minimum ?? nothing} max=${op.capability === 'ha.climate.set_temperature' ? Math.min(parameter.maximum ?? 60, this.status!.maximum) : parameter.maximum ?? nothing} step=${parameter.step ?? 'any'} placeholder="Choose a value" required>` : html`<select aria-label=${parameter.label} name=${parameter.name} required><option value="" disabled selected>Choose an option</option>${parameter.options?.map(option => html`<option value=${option}>${stateLabel(option)}</option>`)}</select>`}</label>`)}
        <button ?disabled=${this.busy || op.capability !== readCapability && !resource.available}>${op.capability === readCapability ? 'Observe current state' : `Request ${op.label.toLocaleLowerCase()}`}</button></form></section>`)}
    </details>`;
  }
  private run(resource: Resource, operation: ActionOption, parameters: Record<string, string | number>) {
    void this.work(async () => { this.outcome = await this.api('actions', { requestId: crypto.randomUUID(), resourceId: resource.id, expiresAt: new Date(Date.now() + 60000).toISOString(), capability: operation.capability, parameters }); });
  }
  private operationChoices(): ActionOption[] {
    const choices = new Map<string, ActionOption>(); for (const resource of this.status!.resources.filter(r => this.grantResources.includes(r.id))) for (const op of resource.operations) choices.set(op.capability, op);
    return [...choices.values()].sort((a, b) => a.capability === readCapability ? -1 : b.capability === readCapability ? 1 : a.label.localeCompare(b.label));
  }
  private chooseTemplate(template: string) {
    this.template = template; this.grantCapabilities = template === 'custom' ? [] : this.operationChoices().filter(op => op.capability === readCapability || template === 'lighting' && op.capability.startsWith('ha.light.') || template === 'media' && op.capability.startsWith('ha.media.')).map(op => op.capability);
    if (this.grantCapabilities.includes('ha.media.volume') && !this.volumeLimit) this.volumeLimit = '40';
  }
  private cancelEdit() { this.editMember = undefined; this.grantResources = []; this.grantCapabilities = []; this.template = 'custom'; this.volumeLimit = ''; }
  private beginEdit(member: Member) {
    this.secret = ''; this.editMember = member; this.grantResources = [...member.resources]; this.grantCapabilities = [...member.capabilities]; this.template = 'custom';
    this.volumeLimit = member.capabilities.includes('ha.media.volume') ? String(member.limits?.maxVolumePct ?? 100) : '';
    void this.updateComplete.then(() => this.renderRoot.querySelector('form.access-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  private async copyCredential() {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(this.secret);
      this.feedback = 'Credential copied. Paste it only into this client’s secret storage.';
    } catch { this.message = 'Automatic copy is unavailable in this browser. Select and copy the private credential shown above.'; }
  }
  private clientGuide(resources: Resource[], capabilities: string[]) {
    const baseUrl = this.status!.connectionGuide?.baseUrl ?? 'http://[internal-app-hostname]:8098';
    const readable = capabilities.includes(readCapability) ? resources.find(resource => resource.readable) : undefined;
    return html`<details><summary>Connect this service client</summary><ol><li>Use a trusted client that can reach the Home Assistant private app network. The credential belongs in that client’s secret storage.</li><li>List its permitted resources using the address below. This authenticates the client without operating a device.</li><li>Watch this profile’s last authenticated request, then review Activity for its observations or controls.</li></ol><p class="hint">Creating a profile grants permission. It does not pair a phone, install software, or prove a physical device’s identity. Direct phone joining and ordinary household-user sign-in are not available in this preview.</p><p>Private client address</p><code>${baseUrl}</code><p class="hint">This address works only from the HA app network. No public port or remote access is opened.${this.status!.connectionGuide?.baseUrl ? '' : ' Find the app hostname in HA app information and replace the placeholder.'}</p><p>First authenticated request</p><code>GET ${baseUrl}/v1/resources
Authorization: Bearer [your saved client credential]</code><p class="hint">The response lists only this profile’s resources and permitted operation names. A successful request updates its usage status; it does not mean the client remains online.</p>${resources.length ? html`<p>Selected resources</p><ul>${resources.map(resource => html`<li>${resource.name}<code>${resource.id}</code></li>`)}</ul>` : nothing}${readable ? html`<p>Then try a status observation. Your client supplies a fresh UUID and expiry for each request.</p><code>POST ${baseUrl}/v1/actions
Authorization: Bearer [your saved client credential]
Content-Type: application/json

${JSON.stringify({ requestId: '[fresh UUID v4]', resourceId: readable.id, capability: readCapability, parameters: {}, expiresAt: '[UTC time within the next two minutes]' }, null, 2)}</code>` : nothing}</details>`;
  }
  private accessCreated() {
    return html`<section class="notice success"><h2>Access created</h2><p>Permission is ready. No client has connected just because this profile was created.</p><p>Save its private client credential now. It is shown once and is separate from your Home Assistant credentials.</p><code>${this.secret}</code><div class="actions"><button ?disabled=${this.busy} @click=${() => { void this.copyCredential(); }}>Copy credential</button><button ?disabled=${this.busy} @click=${() => { this.secret = ''; this.secretScope = undefined; }}>I have saved it</button></div>${this.clientGuide(this.secretScope?.resources ?? [], this.secretScope?.capabilities ?? [])}</section>`;
  }
  private access() {
    const choices = this.operationChoices(); const editing = this.editMember;
    return html`<p class="eyebrow">Useful access, on your terms</p><h1>Who may do what?</h1><p class="page-description">Give each person, agent, machine or device its own resources, operations and expiry. An observer can read without controlling anything.</p><p class="hint">These are service-client access profiles. A trusted client must be connected separately; creating one does not pair a phone or add a native HA user.</p>
      ${this.secret ? this.accessCreated() : nothing}
      <form class="card access-form" @submit=${(event: Event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; if (!form.reportValidity()) return; const data = new FormData(form); void this.work(async () => { const limits = this.grantCapabilities.includes('ha.media.volume') ? { maxVolumePct: Number(this.volumeLimit) } : {}; const scope = { hours: Number(data.get('hours')), resources: this.grantResources, capabilities: this.grantCapabilities, limits }; if (editing) { await this.api('access/update', { id: editing.id, ...scope }); this.feedback = 'Access updated. Its existing client credential still works with the new scope.'; } else { const result = await this.api('access', { name: String(data.get('name')), kind: String(data.get('kind')), ...scope }); this.secret = result.credential; this.secretScope = { resources: this.status!.resources.filter(resource => scope.resources.includes(resource.id)), capabilities: [...scope.capabilities] }; } this.cancelEdit(); form.reset(); }); }}>
        <h2>${editing ? `Update access for ${editing.name}` : 'Create an access profile'}</h2>${editing ? html`<p>Review the resources and operations, then choose how long the revised access lasts. Its client credential is preserved.</p>` : html`<label class="field">Give it a familiar name<input name="name" placeholder="Household observer or media helper" maxlength="80" required></label>`}
        <div class="ranges">${!editing ? html`<label class="field">Who or what is it?<select name="kind"><option value="agent">AI agent</option><option value="machine">Computer or controller</option><option value="device">Device</option><option value="service">Service</option><option value="person">Person using a service client</option></select></label>` : nothing}<label class="field">Access lasts<select name="hours"><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option><option value="1">1 hour</option></select></label></div>
        <fieldset><legend>1. Choose its resources</legend><p class="hint">Only resources you already shared appear here.</p><div class="scope">${this.status!.resources.map(r => html`<label class="pick"><input type="checkbox" aria-label=${`Allow ${r.name}`} .checked=${this.grantResources.includes(r.id)} ?disabled=${this.busy} @change=${(e: Event) => { this.grantResources = this.toggle(this.grantResources, r.id, (e.target as HTMLInputElement).checked); const supported = new Set(this.operationChoices().map(op => op.capability)); this.grantCapabilities = this.grantCapabilities.filter(cap => supported.has(cap)); this.template = 'custom'; }}><span><strong>${r.name}</strong><br><small>${kindLabel(r.kind)}</small></span></label>`)}</div></fieldset>
        <fieldset><legend>2. Choose its operations</legend><p class="hint">Start with a template or select exactly what it may request. Review the selected checkboxes before saving.</p><div class="actions">${[['observer', 'Read-only observer'], ['lighting', 'Lighting helper'], ['media', 'Media helper'], ['custom', 'Custom']].map(([value, label]) => html`<button type="button" ?disabled=${this.busy || !this.grantResources.length} aria-pressed=${this.template === value} @click=${() => this.chooseTemplate(value!)}>${label}</button>`)}</div>
          ${choices.length ? choices.map(op => html`<label class="pick"><input type="checkbox" aria-label=${`Permit ${op.label}`} .checked=${this.grantCapabilities.includes(op.capability)} ?disabled=${this.busy} @change=${(e: Event) => { const checked = (e.target as HTMLInputElement).checked; this.grantCapabilities = this.toggle(this.grantCapabilities, op.capability, checked); if (op.capability === 'ha.media.volume' && checked && !this.volumeLimit) this.volumeLimit = '40'; this.template = 'custom'; }}><span><strong>${op.label}</strong><br><small>${op.capability === readCapability ? 'Read a curated state snapshot. No device command.' : 'May operate compatible selected resources.'}</small></span></label>`) : html`<p class="empty">Choose resources first to see their available operations.</p>`}</fieldset>
        ${this.grantCapabilities.includes('ha.media.volume') ? html`<fieldset><legend>3. Set a useful volume limit</legend><label class="field">Maximum volume %<input name="maxVolumePct" type="number" min="0" max="100" step="1" .value=${this.volumeLimit} @input=${(event: Event) => { this.volumeLimit = (event.target as HTMLInputElement).value; }} required></label><p class="hint">Every delegated volume request must stay at or below this cap. A limit of 100 permits the device’s full volume range. This does not change your normal HA controls.</p></fieldset>` : nothing}
        <div class="scope-summary"><p>This profile may request <strong>${this.grantCapabilities.length} operations</strong> on <strong>${this.grantResources.length} selected resources</strong>, only where that operation is supported. All other operations are refused.${this.grantCapabilities.includes('ha.media.volume') ? html` Volume is limited to <strong>${this.volumeLimit || '—'}%</strong>.` : nothing}</p><p class="hint">Each selected operation applies to every compatible selected resource. Use separate profiles when different devices need different operation rules. Access ends after the duration selected above.</p></div><button class="primary" ?disabled=${this.busy || !this.grantResources.length || !this.grantCapabilities.length}>${editing ? 'Save access changes' : 'Create limited access'}</button>${editing ? html`<button type="button" ?disabled=${this.busy} @click=${() => this.cancelEdit()}>Cancel editing</button>` : nothing}
      </form><h2>Existing access</h2>${this.status!.members.map(member => this.memberCard(member))}`;
  }
  private memberCard(member: Member) {
    const labels = new Map(this.status!.resources.flatMap(r => r.operations).map(op => [op.capability, op.label]));
    const state = accessState(member), revoked = state === 'Access revoked', expired = state === 'Access expired';
    return html`<article class="card"><div class="row"><div><h3>${member.name}</h3><small>${member.kind} · ${state} · ${member.resources.length} resources</small><p class="hint">${usageLabel(member)}</p></div>${member.nativeUser ? html`<span class="badge">HA administrator</span>` : html`<div class="actions"><button ?disabled=${this.busy || revoked} @click=${() => this.beginEdit(member)}>${expired ? 'Renew access' : 'Edit access'}</button><button ?disabled=${this.busy || !member.enabled && member.connection?.state !== 'needs_review'} @click=${() => { void this.work(async () => { await this.api('revoke', { id: member.id }); }); }}>End access</button></div>`}</div>
      ${revoked && !member.nativeUser ? html`<p class="hint">This credential stays revoked. Create a new profile if the participant needs access again.</p>` : nothing}${member.legacyLimited ? html`<p class="notice">Original access scope preserved. This profile has not gained observation or new controls from this update. Review access explicitly to add a broader role.</p>` : nothing}${member.limits?.maxVolumePct !== undefined ? html`<p><span class="badge">Maximum volume: ${member.limits.maxVolumePct}%</span></p>` : nothing}<details><summary>What this profile can request</summary><p>${member.capabilities?.map(cap => labels.get(cap) ?? cap).join(' · ') || 'No operations granted'}</p>${member.limits?.maxVolumePct === undefined && member.capabilities.includes('ha.media.volume') ? html`<p class="hint">No extra profile volume cap; the device’s full range is permitted.</p>` : nothing}<p class="hint">Expires ${new Date(member.expiresAt).toLocaleString()}. ${member.nativeUser ? 'Your active native HA administrator role is checked for each request.' : 'Its credential proves possession of this profile, not the identity of physical hardware.'}</p></details>${!member.nativeUser && !revoked ? this.clientGuide(this.status!.resources.filter(resource => member.resources.includes(resource.id)), member.capabilities) : nothing}</article>`;
  }
  private homeView() {
    const status = this.status!; const active = status.members.filter(member => member.enabled && Date.parse(member.expiresAt) > Date.now()).length;
    return html`<p class="eyebrow">Your governed home</p><h1>Make your home useful, with limits you own.</h1><p class="page-description">Genesis Mesh gives people, agents and machines selected ways to observe and operate your home. Your normal HA dashboards and automations keep working.</p>
      <div class="metrics"><div class="metric"><strong>${this.summary?.total ?? this.catalog.length}</strong><span>entities in view</span></div><div class="metric"><strong>${status.resources.length}</strong><span>shared through Mesh</span></div><div class="metric"><strong>${active}</strong><span>valid access profiles</span></div></div>
      <div class="grid"><section class="card"><h2>Bring more of your home in</h2><p>See sensors, plugs, TVs, speakers and every discovered type. Choose what can be shared.</p><button class="primary" @click=${() => this.navigate('devices')}>Explore devices</button></section><section class="card"><h2>Give someone a useful role</h2><p>Create an observer, lighting helper or media helper with selected operations and an expiry.</p><button @click=${() => this.navigate('access')}>Manage access</button></section><section class="card"><h2>Understand what happened</h2><p>Review observations, policy refusals, commands and whether their signed records were received.</p><button @click=${() => this.navigate('activity')}>Review activity</button></section></div>
      <section class="card"><h2>A safe first request</h2><p>Open Devices and try an observation on a shared readable entity. It reads curated state without operating anything.</p><button @click=${() => { this.coverage = 'shared'; this.navigate('devices'); }}>Open shared devices</button></section>
      <details class="card"><summary>Home settings and preview limits</summary><p>${status.custody}</p><p>Other HA controls, automations and vendor apps stay outside these rules. Discovery does not enroll every device as a Mesh node. Some domains appear only in inventory until a suitable adapter is available.</p><p>This preview has no offline authorization, backup rollback recovery or independent physical-result verification.</p><button ?disabled=${this.busy} @click=${() => this.beginSharing()}>Change shared devices</button></details>`;
  }
  private observation(operation: Operation) {
    const observation = operation.observation;
    return observation ? html`<div class="notice success"><strong>Observed state: ${stateLabel(observation.state)}</strong><dl class="observation">${Object.entries(observation.attributes).map(([key, value]) => html`<dt>${key.replaceAll('_', ' ')}</dt><dd>${typeof value === 'string' ? value : JSON.stringify(value)}</dd>`)}</dl><small>Observed ${new Date(observation.observedAt).toLocaleString()}. A snapshot, not a guarantee of its current state.</small></div>` : nothing;
  }
  private result(operation: Operation) {
    return html`<section class="notice" role="status"><h2>${this.operationTitle(operation)}</h2><strong>${commandLabel(operation.commandState)}</strong>${['accepted', 'observed'].includes(operation.commandState) ? nothing : html`<p>${requestExplanation(operation)}</p>`}<p><span class="badge">${recordLabel(operation.evidenceState)}</span></p>${this.observation(operation)}<button @click=${() => { this.outcome = undefined; }}>Dismiss result</button></section>`;
  }
  private operationTitle(operation: Operation): string {
    if (operation.summary) return operation.summary;
    const label = this.catalog.flatMap(resource => resource.operations).find(option => option.capability === operation.capability)?.label;
    const values = Object.entries(operation.parameters ?? {}).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${String(value).slice(0, 100)}`).join(', ');
    return `${label ?? (operation.capability === readCapability ? 'Read current status' : 'Earlier request')}${values ? ` · ${values}` : ''}`;
  }
  private activity() {
    return html`<p class="eyebrow">Decisions & results</p><h1>Requests with a record.</h1><p>Latest 50 requests through this app. Observations, admitted commands and physical outcomes are different kinds of evidence.</p><section class="card">${this.status!.activity.length ? this.status!.activity.map(operation => html`<article class="operation"><h2>${this.operationTitle(operation)}</h2><strong>${commandLabel(operation.commandState)}</strong><p>${this.status!.resources.find(r => r.id === operation.resourceId)?.name ?? 'Previously shared resource'} · requested by ${this.status!.members.find(m => m.id === operation.subjectId)?.name ?? 'Earlier participant'}<br><small>${new Date(operation.createdAt).toLocaleString()}</small></p>${['accepted', 'observed'].includes(operation.commandState) ? nothing : html`<p>${requestExplanation(operation)}</p>`}<span class="badge">${recordLabel(operation.evidenceState)}</span>${this.observation(operation)}<details><summary>Technical reference</summary><code>${operation.id}</code><p>${operation.reason}${operation.policyFailures.length ? ` · ${operation.policyFailures.join(', ')}` : ''}</p></details></article>`) : html`<p class="empty">No requests yet. Observe a shared entity from Devices to see the decision and result here.</p>`}</section>`;
  }
  override render() {
    return html`<header><div><img src="./logo.svg" alt="Genesis Mesh"><strong>Genesis Mesh<br><small>Home Assistant</small></strong></div><span class="badge">Experimental preview</span></header>
      ${this.message ? html`<div class="notice" role="alert">${this.message}<p>After a connection error during a control request, review Activity and the device before another request.</p><button ?disabled=${this.busy} @click=${() => { void this.refresh(); }}>Refresh connection</button></div>` : nothing}
      ${this.feedback ? html`<div class="notice success" role="status"><p>${this.feedback}</p></div>` : nothing}${this.status ? html`${this.status.ready ? html`<nav aria-label="Genesis Mesh">${[['home', 'Home'], ['devices', 'Devices'], ['access', 'Access'], ['activity', 'Activity']].map(([page, label]) => html`<button aria-current=${this.page === page ? 'page' : 'false'} @click=${() => this.navigate(page!)}>${label}</button>`)}</nav>` : nothing}${this.outcome ? this.result(this.outcome) : nothing}<main aria-busy=${this.busy}>${!this.status.ready || this.status.needsRecovery || this.page === 'setup' ? this.setup() : this.page === 'devices' ? this.devices() : this.page === 'access' ? this.access() : this.page === 'activity' ? this.activity() : this.homeView()}</main>` : html`<p role="status">${this.busy ? 'Connecting to your Home Assistant session…' : 'Open this app from Home Assistant with an administrator account.'}</p>`}
      <footer>Identity · Permission · Evidence. ${this.busy ? 'Working…' : ''}</footer>`;
  }
}
customElements.define('genesis-home', GenesisHome);
document.body.style.margin = '0'; document.body.style.background = '#f5f7f3';
