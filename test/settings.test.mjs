import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifySettings } from '../server/settings.mjs';
import { ApiError } from '../server/http.mjs';

const candidate = {secrets:{bot_token:'123456:abcdefghijklmnopqrstuv'}};

test('candidate validation verifies the identity and existing webhook without returning the secret', async () => {
  const calls = [];
  const result = await verifySettings(candidate, token => {
    assert.equal(token, candidate.secrets.bot_token);
    return {call:async method => { calls.push(method); return method === 'getMe' ? {id:91} : {url:''}; }};
  });
  assert.equal(result, undefined);
  assert.deepEqual(calls, ['getMe','getWebhookInfo']);
});

test('malformed, rejected and already connected candidates never complete validation', async () => {
  await assert.rejects(verifySettings({secrets:{bot_token:'not-a-token'}}, () => {throw new Error('must not request provider');}), error => error.status === 400);
  await assert.rejects(verifySettings(candidate, () => ({call:async () => {throw new ApiError(401,'rejected');}})), error => error.status === 401);
  await assert.rejects(verifySettings(candidate, () => ({call:async method => method === 'getMe' ? {id:91} : {url:'https://existing.example/hook'}})), error => error.code === 'webhook-conflict');
});

test('clearing or leaving a secret unchanged needs no provider request', async () => {
  const unexpected = () => {throw new Error('must not request provider');};
  await verifySettings({secrets:{bot_token:''}}, unexpected);
  await verifySettings({values:{full_text:true}}, unexpected);
});
