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

test('Host HTTPS accepts its explicit CA-issued leaf and rejects other certificates and names', async t => {
  const {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {execFileSync}=await import('node:child_process');
  const https=await import('node:https');
  const {HostAPI}=await import('../server/http.mjs');
  const dir=mkdtempSync(join(tmpdir(),'telegram-tls-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const openssl=(...args)=>execFileSync('openssl',args,{cwd:dir,stdio:'ignore'});
  openssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.pem','-days','1','-subj','/CN=QA CA');
  openssl('req','-newkey','rsa:2048','-nodes','-keyout','leaf.key','-out','leaf.csr','-subj','/CN=localhost');
  writeFileSync(join(dir,'san'),'subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\n');
  openssl('x509','-req','-in','leaf.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out','cert.pem','-days','1','-extfile','san');
  const dataDir=join(dir,'extensions','telegram','data');mkdirSync(dataDir,{recursive:true});
  let calls=0;
  const s=https.createServer({key:readFileSync(join(dir,'leaf.key')),cert:readFileSync(join(dir,'cert.pem'))},(_,res)=>{calls++;res.end('{"ok":true}');});
  await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>s.close(resolve)));
  const url=`https://localhost:${s.address().port}`;
  const api=new HostAPI({url,token:'synthetic-host-token',dataDir});
  await assert.rejects(jsonRequest(new URL(url),{ca:api.ca}));
  assert.deepEqual(await api.request('/api/ext/v1/me'),{ok:true});
  const wrongName=new HostAPI({url:`https://127.0.0.1:${s.address().port}`,token:'synthetic-host-token',dataDir});
  await assert.rejects(wrongName.request('/api/ext/v1/me'));
  openssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout','other.key','-out','other.pem','-days','1','-subj','/CN=Other QA CA');
  await assert.rejects(jsonRequest(new URL(url),{ca:readFileSync(join(dir,'other.pem')),allowPartialTrustChain:true}));
  assert.equal(calls,1,'only the explicitly trusted certificate with the correct name received a request');
});


test('malformed provider success cannot turn a possibly sent message into a known refusal',async()=>{
 for(const response of [null,{},true,{ok:true},{ok:true,result:{}},{ok:true,result:{message_id:'123'}}]) {
   const api=new TelegramAPI('synthetic',{request:async()=>response});
   await assert.rejects(api.call('sendMessage',{text:'fixture'}),error=>error.uncertain===true && error.status===502);
 }
 const api=new TelegramAPI('synthetic',{request:async()=>({ok:true,result:{message_id:123}})});
 assert.deepEqual(await api.call('sendMessage',{text:'fixture'}),{message_id:123});
});

test('Host API v2 exposes only the four explicit extension doors',async t=>{
 const {HostAPI}=await import('../server/http.mjs');let calls=0;
 const origin=await server(t,(_,res)=>{calls++;res.end('{"fixture":true}');});
 const api=new HostAPI({url:origin,token:'synthetic',dataDir:'.'});
 for(const path of ['/api/ext/v2/channel/session','/api/ext/v2/assistants','/api/ext/v2/assistants/messages','/api/ext/v2/assistants/replies/check']) assert.deepEqual(await api.request(path),{fixture:true});
 for(const path of ['/api/ext/v2/settings','/api/channels/access','/api/assistants','/api/ext/v2/assistants/../settings']) assert.throws(()=>api.request(path));
 assert.equal(calls,4);
});
