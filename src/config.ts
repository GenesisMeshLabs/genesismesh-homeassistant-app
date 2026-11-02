import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Ajv } from 'ajv';
import { parseJson } from 'genesis-mesh-sdk';
import { configSchema, type RuntimeConfig } from './contracts.js';

const validate = new Ajv({ strict: true, coerceTypes: false, removeAdditional: false, useDefaults: false }).compile<RuntimeConfig>(configSchema);

export function endpoint(value: string): string {
  const url = new URL(value);
  const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new Error('Configured endpoints must use HTTPS, or explicit numeric loopback HTTP, without credentials or query strings.');
  }
  return value.replace(/\/+$/, '');
}

export function validateConfig(value: unknown, profile: 'standalone' | 'supervisor' = 'standalone'): RuntimeConfig {
  if (!validate(value)) throw new Error('Configuration has missing, unknown or invalid fields.');
  const config = structuredClone(value);
  endpoint(config.authority.url);
  if (!(profile === 'supervisor' && config.homeAssistant.url === 'http://supervisor/core/api')) endpoint(config.homeAssistant.url);
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(config.principals.map(p => p.id)) || !unique(config.principals.map(p => p.credentialSha256)) ||
      !unique(config.principals.map(p => p.attestationId)) || !unique(config.resources.map(r => r.id)) ||
      !unique(config.resources.map(r => r.entityId)) || !unique(config.authority.expectations.map(e => e.capability))) {
    throw new Error('Subjects, credentials, attestations, resources and capability expectations must be unique.');
  }
  for (const principal of config.principals) {
    if (!Number.isFinite(Date.parse(principal.expiresAt)) || principal.resources.some(id => !config.resources.some(r => r.id === id))) {
      throw new Error('Participant expiry or resource mapping is invalid.');
    }
  }
  for (const resource of config.resources) {
    if (!resource.entityId.startsWith(`${resource.kind}.`)) throw new Error('Resource kind must match its HA entity domain.');
  }
  for (const expectation of config.authority.expectations) {
    if (!unique(expectation.policies.map(p => p.id))) throw new Error('Policy references must be unique per capability.');
  }
  return config;
}

export function loadConfig(file: string): RuntimeConfig {
  const config = validateConfig(parseJson(readFileSync(file, 'utf8')));
  const base = dirname(resolve(file));
  config.dataDir = resolve(base, config.dataDir);
  config.authority.operatorKeyFile = resolve(base, config.authority.operatorKeyFile);
  config.authority.executorKeyFile = resolve(base, config.authority.executorKeyFile);
  config.homeAssistant.tokenFile = resolve(base, config.homeAssistant.tokenFile);
  return config;
}
