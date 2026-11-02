import { randomBytes } from 'node:crypto';
import { parseJson } from 'genesis-mesh-sdk';
import { AppError } from './errors.js';

export interface HaUser { id: string; name: string }
export interface HaRoles { requireAdministrator(id: string): Promise<HaUser> }

export class SupervisorRoles implements HaRoles {
  constructor(private readonly token: string, private readonly url = 'ws://supervisor/core/websocket') {}

  async requireAdministrator(id: string): Promise<HaUser> {
    const users = await new Promise<unknown[]>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      let settled = false;
      const finish = (result?: unknown[]) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); socket.close();
        if (result) resolve(result);
        else reject(new AppError('ha_identity_unavailable', 'Home Assistant could not verify your current administrator access. Try again when it is available.', 503));
      };
      const timeout = setTimeout(() => finish(), 5000);
      socket.addEventListener('error', () => finish());
      socket.addEventListener('close', () => { if (!settled) finish(); });
      socket.addEventListener('message', event => {
        try {
          const text = String(event.data);
          if (text.length > 1024 * 1024) return finish();
          const message = parseJson(text) as Record<string, unknown>;
          if (message['type'] === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: this.token }));
          else if (message['type'] === 'auth_ok') socket.send(JSON.stringify({ id: 1, type: 'config/auth/list' }));
          else if (message['type'] === 'auth_invalid') finish();
          else if (message['type'] === 'result' && message['id'] === 1) {
            finish(message['success'] === true && Array.isArray(message['result']) ? message['result'] : undefined);
          }
        } catch { finish(); }
      });
    });
    const user = users.find((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && 'id' in entry && entry.id === id);
    if (!user || user['is_active'] !== true || user['system_generated'] === true ||
        !(user['is_owner'] === true || (Array.isArray(user['group_ids']) && user['group_ids'].includes('system-admin')))) {
      throw new AppError('administrator_required', 'This preview is managed by active Home Assistant administrators only.', 403);
    }
    return { id, name: String(user['name'] ?? 'Home administrator').slice(0, 120) };
  }
}

export function ingressUser(address: string, header: string | string[] | undefined): string {
  if (address.replace(/^::ffff:/, '') !== '172.30.32.2') {
    throw new AppError('ingress_required', 'Open this app through Home Assistant.', 403);
  }
  if (typeof header !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(header)) {
    throw new AppError('ha_user_required', 'Home Assistant did not identify this session. Reopen the app after signing in.', 401);
  }
  return header;
}

export class CsrfSessions {
  private readonly sessions = new Map<string, { user: string; expires: number }>();
  issue(user: string): string {
    for (const [token, session] of this.sessions) if (session.expires <= Date.now()) this.sessions.delete(token);
    if (this.sessions.size >= 256) this.sessions.delete(this.sessions.keys().next().value!);
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { user, expires: Date.now() + 10 * 60 * 1000 });
    return token;
  }
  check(user: string, token: string | string[] | undefined): void {
    const session = typeof token === 'string' ? this.sessions.get(token) : undefined;
    if (!session || session.user !== user || session.expires <= Date.now()) {
      throw new AppError('session_expired', 'Refresh the app before changing access or sending a request.', 403);
    }
  }
}
