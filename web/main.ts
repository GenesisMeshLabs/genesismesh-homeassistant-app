import { LitElement, html, css } from 'lit';

interface Resource { id: string; name: string; kind: 'climate' | 'light' }
interface Member { id: string; name: string; kind: string; resources: string[]; enabled: boolean; expiresAt: string; nativeUser: boolean }
interface Operation { id: string; requestId: string; subjectId: string; resourceId: string; commandState: string; evidenceState: string; reason: string; createdAt: string; policyFailures: string[] }
interface Status { ready: boolean; needsRecovery: boolean; minimum: number; maximum: number; resources: Resource[]; members: Member[]; activity: Operation[]; custody: string }

class GenesisHome extends LitElement {
  static override properties = { status: { state: true }, catalog: { state: true }, page: { state: true }, busy: { state: true }, message: { state: true }, secret: { state: true }, name: { state: true }, selected: { state: true }, outcome: { state: true } };
  declare private status: Status | undefined;
  declare private catalog: Resource[];
  declare private page: string; declare private busy: boolean; declare private message: string; declare private secret: string; declare private name: string;
  private csrf = ''; declare private selected: string[]; declare private outcome: Operation | undefined;
  constructor() {
    super(); this.catalog = []; this.page = 'home'; this.busy = false; this.message = ''; this.secret = ''; this.name = ''; this.selected = [];
  }
  static override styles = css`
    :host{display:block;color:#1d3026;font:16px/1.5 system-ui,sans-serif;max-width:1080px;margin:auto;padding:24px;box-sizing:border-box}
    *{box-sizing:border-box}header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:32px}header img{width:65px;height:40px;object-fit:contain}header div{display:flex;align-items:center;gap:12px}h1{font-size:clamp(27px,5vw,38px);line-height:1.15;margin:10px 0 16px}h2{font-size:22px;margin:0 0 12px}p{margin:8px 0 18px}.hint,small{color:#52655b}.eyebrow{text-transform:uppercase;font-size:12px;letter-spacing:.1em;font-weight:700}nav{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}button,input,select{font:inherit;border-radius:10px;border:1px solid #aebfb4;padding:11px 15px}button{cursor:pointer;background:white;color:#1d3026;font-weight:650}button.primary,nav button[aria-current="page"]{background:#c5ec9b;border-color:#a3cb78}button:disabled{opacity:.5;cursor:wait}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #478966;outline-offset:2px}.card{background:white;border:1px solid #d6e0d9;border-radius:16px;padding:24px;margin:16px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.grid .card{margin:0}.row{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.notice{background:#fff3d8;border:1px solid #ddc48b;border-radius:12px;padding:16px;margin:16px 0}.success{background:#e4f3d9}.pick{display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid #edf1ee}.pick input{width:22px;height:22px}.pick span{flex:1}label.field{display:block;margin:14px 0}label.field input,label.field select{display:block;margin-top:6px;max-width:100%;width:100%}.ranges{display:flex;gap:16px}.ranges label{flex:1}.badge{border-radius:20px;background:#edf3e9;padding:4px 10px;font-size:13px}form{max-width:650px}fieldset{border:0;padding:0;margin:16px 0}legend{font-weight:650}code{display:block;overflow-wrap:anywhere;white-space:pre-wrap;background:#f0f4ee;padding:16px;border-radius:10px}details{margin-top:20px}summary{cursor:pointer}ul{padding-left:20px}.empty{padding:22px 0}.operation{padding:16px 0;border-bottom:1px solid #edf1ee}footer{font-size:13px;color:#607067;margin:32px 0}@media(max-width:550px){:host{padding:16px}.card{padding:18px}.ranges{display:block}header{align-items:flex-start}header .badge{max-width:130px}nav button{flex:1}h1{font-size:29px}}
  `;

  override connectedCallback() { super.connectedCallback(); void this.refresh(); }
  private async api(path: string, body?: unknown): Promise<any> {
    const response = await fetch(new URL(`api/${path}`, document.baseURI), { credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GM-CSRF': this.csrf }, body: JSON.stringify(body) }) });
    const value = await response.json();
    if (!response.ok && !value.commandState) throw new Error(value.error?.message ?? 'The home could not complete the request.');
    return value;
  }
  private async refresh() {
    this.busy = true; this.message = '';
    try { const session = await this.api('session'); this.csrf = session.csrf; this.name = session.name;
      this.status = await this.api('status'); if (!this.status!.ready) { this.catalog = (await this.api('catalog')).resources; this.selected = this.status!.resources.map(r => r.id); }
    } catch (error) { this.message = error instanceof Error ? error.message : 'The home is unavailable.'; }
    finally { this.busy = false; }
  }
  private async work(action: () => Promise<void>) {
    this.busy = true; this.message = '';
    try { await action(); this.status = await this.api('status'); }
    catch (error) { this.message = error instanceof Error ? error.message : 'The home is unavailable. Review Activity before retrying a request.'; }
    finally { this.busy = false; }
  }
  private resourcePicker(resources: Resource[], selected: string[], change: (id: string, checked: boolean) => void) {
    return html`<fieldset><legend>Choose the resources</legend>${resources.map(r => html`<label class="pick"><input type="checkbox" .checked=${selected.includes(r.id)} ?disabled=${this.busy} @change=${(e: Event) => change(r.id, (e.target as HTMLInputElement).checked)}><span>${r.name}<br><small>${r.kind === 'climate' ? 'Heating · Celsius setpoint' : 'Light · on or off'}</small></span></label>`)}</fieldset>`;
  }
  private setup() {
    return html`<p class="eyebrow">1 · Choose what can be shared</p><h1>Your home. Your limits.</h1><p>Keep using Home Assistant as usual. Choose the lights and heating this app may expose to people, agents and devices.</p>
      ${this.status?.needsRecovery ? html`<p class="notice">An earlier access update was interrupted. Review and save the resource selection to finish it. Existing keys have been preserved.</p>` : ''}
      <form class="card" @submit=${(event: Event) => { event.preventDefault(); const data = new FormData(event.target as HTMLFormElement); void this.work(async () => { await this.api('setup', { resources: this.selected, minimum: Number(data.get('minimum')), maximum: Number(data.get('maximum')) }); this.page = 'access'; }); }}>
        ${this.catalog.length ? this.resourcePicker(this.catalog, this.selected, (id, checked) => { this.selected = checked ? [...this.selected, id] : this.selected.filter(v => v !== id); }) : html`<p>No supported lights or climate entities were found. Check Home Assistant and refresh.</p>`}
        <h2>Heating limits</h2><p class="hint">Every delegated setpoint must stay in this range and within the device’s own limits.</p><div class="ranges"><label class="field">Minimum °C<input name="minimum" type="number" min="10" max="35" step="0.5" .value=${String(this.status?.minimum ?? 19)} required></label><label class="field">Maximum °C<input name="maximum" type="number" min="10" max="35" step="0.5" .value=${String(this.status?.maximum ?? 23)} required></label></div>
        <button class="primary" ?disabled=${this.busy || !this.selected.length}>Save and continue</button><p class="hint">This creates access rules. It does not operate your devices.</p></form>`;
  }
  private access() {
    const state = this.status!;
    return html`<p class="eyebrow">2 · Give useful access</p><h1>Who may do what?</h1><p>Create a separate access profile for each person, agent, machine or device. Each request gets its own policy decision.</p>
      ${this.secret ? html`<div class="notice success"><h2>Access created</h2><p>Copy this private service credential now. It will not be shown again. It grants only the resources and lifetime you selected.</p><code>${this.secret}</code><button ?disabled=${this.busy} @click=${() => { this.secret = ''; }}>I have saved it</button><p class="hint">For trusted service clients inside the HA app network, port 8098. No public host port is opened. Native device enrollment and remote pairing come later.</p></div>` : ''}
      <form class="card" @submit=${(event: Event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const data = new FormData(form); void this.work(async () => { const result = await this.api('access', { name: String(data.get('name')), kind: String(data.get('kind')), hours: Number(data.get('hours')), resources: data.getAll('resources') }); this.secret = result.credential; form.reset(); }); }}>
        <label class="field">Give it a familiar name<input name="name" placeholder="Heating assistant or greenhouse controller" maxlength="80" required></label><div class="ranges"><label class="field">Who or what is it?<select name="kind"><option value="agent">AI agent</option><option value="machine">Computer or controller</option><option value="device">Device</option><option value="service">Service</option><option value="person">Person using a service client</option></select></label><label class="field">Access lasts<select name="hours"><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option><option value="1">1 hour</option></select></label></div>
        <fieldset><legend>Can use</legend>${state.resources.map(r => html`<label class="pick"><input type="checkbox" name="resources" value=${r.id}><span>${r.name}<br><small>${r.kind === 'climate' ? `${state.minimum}–${state.maximum} °C` : 'On / off only'}</small></span></label>`)}</fieldset><button class="primary" ?disabled=${this.busy}>Create limited access</button></form>
      <h2>Existing access</h2>${state.members.map(m => html`<div class="card row"><div><strong>${m.name}</strong><br><small>${m.kind} · ${m.enabled && Date.parse(m.expiresAt) > Date.now() ? 'Access active' : 'Access ended'} · ${m.resources.length} resources</small></div>${m.nativeUser ? html`<span class="badge">HA administrator</span>` : html`<button ?disabled=${this.busy || !m.enabled} @click=${() => { void this.work(async () => { await this.api('revoke', { id: m.id }); }); }}>End access</button>`}</div>`)}`;
  }
  private homeView() {
    const state = this.status!;
    return html`<p class="eyebrow">Your governed home</p><h1>Useful access, with clear limits.</h1><p>${state.resources.length} resources are shared through Genesis Mesh. Your normal Home Assistant controls and automations keep working.</p><div class="grid"><section class="card"><h2>Add an agent or device</h2><p>Choose what it can use and when its access ends.</p><button class="primary" @click=${() => { this.page = 'access'; }}>Manage access</button></section><section class="card"><h2>Understand a request</h2><p>See what was allowed, what was sent, and whether its record was received.</p><button @click=${() => { this.page = 'activity'; }}>Review activity</button></section></div>
      <details class="card"><summary>Try a request as ${this.name}</summary><p>These buttons send a real request to your selected device. They use your own authenticated administrator identity.</p>${state.resources.map(r => html`<div class="operation"><strong>${r.name}</strong>${r.kind === 'light' ? html`<div class="row"><button ?disabled=${this.busy} @click=${() => this.run(r, { state: 'on' })}>Turn on</button><button ?disabled=${this.busy} @click=${() => this.run(r, { state: 'off' })}>Turn off</button></div>` : html`<form class="row" @submit=${(e: Event) => { e.preventDefault(); this.run(r, { temperatureC: Number(new FormData(e.target as HTMLFormElement).get('temperature')) }); }}><label>Setpoint °C <input name="temperature" type="number" min=${state.minimum} max=${state.maximum} step="0.5" .value=${String(state.minimum)} required></label><button ?disabled=${this.busy}>Send request</button></form>`}</div>`)}</details>
      ${this.outcome ? html`<div class="notice"><strong>${this.commandLabel(this.outcome.commandState)}</strong><p>Record: ${this.outcome.evidenceState.replaceAll('_', ' ')}. ${this.outcome.policyFailures.length ? 'A configured access rule refused this request.' : ''}</p></div>` : ''}
      <details class="card"><summary>Home settings and preview limits</summary><p>${state.custody}</p><p>This is an experimental local-custody release. There is no offline authorization, backup rollback recovery, full-device interception or independent physical-result verification.</p><p>Other Home Assistant, vendor and physical controls remain outside these rules. Service credentials prove possession; they do not prove a device’s hardware identity.</p><button ?disabled=${this.busy} @click=${() => { void this.work(async () => { this.catalog = (await this.api('catalog')).resources; this.selected = state.resources.map(r => r.id); this.page = 'setup'; }); }}>Change shared resources</button></details>`;
  }
  private commandLabel(state: string) { return ({ accepted: 'Home Assistant accepted the command. Physical result is unconfirmed.', denied: 'Access rule refused the request. No command was sent.', blocked: 'The request stopped before dispatch.', outcome_unknown: 'The result is unknown. Check the device; do not repeat the request automatically.' } as Record<string, string>)[state] ?? state; }
  private run(resource: Resource, parameters: unknown) {
    void this.work(async () => { this.outcome = await this.api('actions', { requestId: crypto.randomUUID(), resourceId: resource.id,
      expiresAt: new Date(Date.now() + 60000).toISOString(), capability: resource.kind === 'climate' ? 'ha.climate.set_temperature' : 'ha.light.set', parameters }); });
  }
  private activity() {
    return html`<p class="eyebrow">3 · Review what happened</p><h1>Requests with a record.</h1><p>This shows the latest 50 requests through this app. It is not a complete history of your home.</p><section class="card">${this.status!.activity.length ? this.status!.activity.map(op => html`<article class="operation"><strong>${this.commandLabel(op.commandState)}</strong><p>${this.status!.resources.find(r => r.id === op.resourceId)?.name ?? 'Previously shared resource'} · ${this.status!.members.find(m => m.id === op.subjectId)?.name ?? 'Earlier participant'}<br><small>${new Date(op.createdAt).toLocaleString()} · record ${op.evidenceState.replaceAll('_', ' ')}</small></p><details><summary>Technical reference</summary><code>${op.id}</code><p>${op.reason}${op.policyFailures.length ? ` · ${op.policyFailures.join(', ')}` : ''}</p></details></article>`) : html`<p class="empty">No requests yet. Create access or try a request from Home to see how decisions and results appear.</p>`}</section>`;
  }
  override render() {
    return html`<header><div><img src="./logo.svg" alt="Genesis Mesh"><strong>Genesis Mesh<br><small>Home Assistant</small></strong></div><span class="badge">Experimental preview</span></header>
      ${this.message ? html`<div class="notice" role="alert">${this.message}<p>After a connection error during an action, review Activity and the device before sending another request.</p><button ?disabled=${this.busy} @click=${() => { void this.refresh(); }}>Refresh connection</button></div>` : ''}
      ${this.status ? html`${this.status.ready ? html`<nav aria-label="Genesis Mesh"><button aria-current=${this.page === 'home' ? 'page' : 'false'} @click=${() => { this.page = 'home'; }}>Home</button><button aria-current=${this.page === 'access' ? 'page' : 'false'} @click=${() => { this.page = 'access'; }}>Access</button><button aria-current=${this.page === 'activity' ? 'page' : 'false'} @click=${() => { this.page = 'activity'; void this.refresh(); }}>Activity</button></nav>` : ''}<main aria-busy=${this.busy}>${!this.status.ready || this.page === 'setup' ? this.setup() : this.page === 'access' ? this.access() : this.page === 'activity' ? this.activity() : this.homeView()}</main>` : html`<p role="status">${this.busy ? 'Connecting to your Home Assistant session…' : 'Open this app from Home Assistant with an administrator account.'}</p>`}
      <footer>Identity · Permission · Evidence. ${this.busy ? 'Working…' : ''}</footer>`;
  }
}
customElements.define('genesis-home', GenesisHome);
document.body.style.margin = '0'; document.body.style.background = '#f5f7f3';

