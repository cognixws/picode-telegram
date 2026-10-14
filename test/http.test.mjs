import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { TelegramAPI, jsonRequest } from '../server/http.mjs';

async function server(t, fn) {
  const s = http.createServer(fn);
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => s.close(resolve)));
  return `http://127.0.0.1:${s.address().port}`;
}

test('Telegram HTTP 429 retains retry-after without exposing the response', async t => {
  const origin = await server(t, (_, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error_code: 429, description: 'sensitive-provider-detail', parameters: { retry_after: 12 } }));
  });
  const api = new TelegramAPI('fake-token', { origin });
  await assert.rejects(api.call('sendMessage'), e => e.status === 429 && e.retryAfter === 12 && !e.uncertain && !e.message.includes('sensitive'));
});

test('redirects never receive a token or a second request', async t => {
  let calls = 0;
  const origin = await server(t, (_, res) => { calls++; res.writeHead(302, { Location: '/other' }); res.end('{}'); });
  await assert.rejects(jsonRequest(new URL(origin), { method: 'POST', body: { secret: 'private' } }), e => e.status === 302);
  assert.equal(calls, 1);
});

test('a lost write response is uncertain and never reports the token URL', async t => {
  const origin = await server(t, (_, res) => res.destroy());
  const api = new TelegramAPI('private-token', { origin });
  await assert.rejects(api.call('sendMessage'), e => e.uncertain && !e.message.includes('private-token') && !e.message.includes(origin));
});

test('a trickling write response still expires at the total deadline', async t => {
  let chunks = 0;
  const origin = await server(t, (_, res) => {
    res.writeHead(200, {'Content-Type':'application/json'}); res.write('{');
    const trickle = setInterval(() => { chunks++; res.write(' '); }, 10);
    const watchdog = setTimeout(() => res.destroy(), 1000);
    res.on('close', () => {clearInterval(trickle); clearTimeout(watchdog);});
  });
  const started = Date.now();
  await assert.rejects(jsonRequest(new URL(origin), {method:'POST',body:{action:'synthetic'},timeout:150}), error => error.uncertain && error.status === 0);
  assert.ok(chunks >= 3, 'the response was actively trickling');
  assert.ok(Date.now()-started < 700, 'the total deadline ended an active response');
});
