import test from 'node:test';
import assert from 'node:assert/strict';
import { HomeAssistant } from '../src/home-assistant.js';
import { compileAction } from '../src/requests.js';
import { configuration, intent } from './helpers.js';

test('HA redirect, unavailable target, wrong identity and oversized upstream payload fail preflight', async () => {
  const { config } = configuration('unused');
  const action = compileAction(config, config.principals[0]!, intent());
  for (const response of [
    new Response('{}', { status: 302, headers: { location: 'https://other.example' } }),
    new Response(JSON.stringify({ entity_id: 'climate.living_room', state: 'unavailable' })),
    new Response(JSON.stringify({ entity_id: 'climate.another_home', state: 'heat' })),
    new Response(' '.repeat(65537)),
  ]) {
    const home = new HomeAssistant(config.homeAssistant.url, 'private-upstream-credential', async (_input, init) => {
      assert.equal(init?.redirect, 'error');
      return response;
    });
    await assert.rejects(() => home.preflight(action), /could not be checked/);
  }
});

test('an exception or failure response after sending never produces a success claim or retry', async () => {
  const { config } = configuration('unused');
  const action = compileAction(config, config.principals[0]!, intent());
  let count = 0;
  const home = new HomeAssistant(config.homeAssistant.url, 'test-upstream-credential', async () => {
    count++; throw new TypeError('Connection lost after sending');
  });
  assert.equal(await home.dispatch(action), 'outcome_unknown');
  assert.equal(count, 1);
  const failed = new HomeAssistant(config.homeAssistant.url, 'test-upstream-credential', async () => new Response('{}', { status: 500 }));
  assert.equal(await failed.dispatch(action), 'outcome_unknown');
});
