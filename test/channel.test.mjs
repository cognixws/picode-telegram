import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Ledger } from '../server/ledger.mjs';
import { Channel } from '../server/channel.mjs';
import { ApiError } from '../server/http.mjs';

async function fixture(t) {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../migrations/001_ledger.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../migrations/002_channels_v2.sql', import.meta.url), 'utf8'));
  // A file is not needed: share this real migrated SQLite connection.
  const ledger = Object.create(Ledger.prototype);
  let now = 1_800_000_000_000;
  ledger.db = database; ledger.now = () => now;
  t.after(() => ledger.close());
  const provider = [], mutations = [];
  let inbox = [], messages = [], cursor = 100, providerError, failMutation, truncated = false;
  const host = { request: async (path, body) => {
    if (body) {
      mutations.push({ path, body });
      if (failMutation) throw failMutation;
      if (path.includes('/respond')) { inbox = inbox.map(i => i.id === 'question' ? { ...i, state: 'done', answerable: false } : i); return { toast: 'Answer sent — the agent was waiting for it.' }; }
      return { message: { id: 'core-message', state: 'delivered' }, to: { id: 'agent', name: 'Worker' } };
    }
    if (path.endsWith('/me')) return { publicUrl: 'https://cognix.example', channelProtocol: 1, channel: { name: 'Telegram' }, restoreGeneration: '' };
    if (path.endsWith('/settings')) return { secrets: { bot_token: 'token' }, values: { full_text: false } };
    if (path.startsWith('/api/ext/v1/inbox')) return { items: inbox, cursor: cursor++, truncated };
    if (path.startsWith('/api/ext/v1/messages')) return { messages, cursor: cursor++ };
    if (path.endsWith('/agents')) return { agents: [{ id: 'agent', name: 'Worker', running: true }, { id: 'stopped', name: 'Stopped', running: false }] };
    throw new Error('Unexpected Host API route');
  } };
  const bot = { call: async (method, body) => {
    if (method === 'getMe') return { id: 91, username: 'test_bot' };
    if (method === 'getWebhookInfo') return { url: '' };
    provider.push({ method, body });
    if (providerError) throw providerError;
    return { message_id: provider.length + 100 };
  } };
  const channel = new Channel({ ledger, host, makeBot: () => bot, now: ledger.now, spacing: 0 });
  await channel.configure();
  const owner = { id: 14 }, chat = { id: 14, type: 'private' };
  ledger.pair({ code: ledger.pairingCode().code, chat, user: owner, messageTime: 1_800_000_000 });
  let updateID = 1;
  const update = (text, extra = {}) => ({ update_id: updateID++, message: { message_id: updateID, date: 1_800_000_000, from: owner, chat, text, ...extra } });
  return { ledger, channel, provider, mutations, update, advance: ms => { now += ms; }, setTruncated: x => {truncated = x;}, setInbox: x => { inbox = x; }, setMessages: x => { messages = x; }, setProviderError: x => { providerError = x; }, setMutationError: x => { failMutation = x; } };
}

test('connection transitions use the manifest v3 closed host status states', async t => {
  const f = await fixture(t);
  assert.equal(f.channel.status().state, 'connected');
  f.ledger.unpair();
  assert.equal(f.channel.status().state, 'pairing');
  assert.equal(f.channel.pause(true).state, 'paused');
  f.channel.pause(false);
  f.channel.verifying = true;
  assert.equal(f.channel.status().state, 'checking');
  f.channel.verifying = false;
  f.channel.problem = 'Connection unavailable';
  assert.equal(f.channel.status().state, 'error');
  f.channel.problem = '';
  f.channel.bot = null;
  assert.equal(f.channel.status().state, 'needs-token');
});

test('strangers and groups are ignored without a core mutation or acknowledgement', async t => {
  const f = await fixture(t);
  await f.channel.receive(f.update('private content', { from: { id: 20 } }));
  await f.channel.receive(f.update('private content', { chat: { id: 14, type: 'group' } }));
  assert.equal(f.provider.length, 0);
  assert.equal(f.mutations.length, 0);
});

test('Inbox forwards titles and options, not full bodies; duplicate events do not send twice', async t => {
  const f = await fixture(t);
  const item = { id: 'question', title: 'Which database?', body: 'private context', options: ['SQLite', 'Postgres'], state: 'unread', answerable: true };
  f.setInbox([item]);
  await f.channel.inboxOnce(); await f.channel.inboxOnce();
  assert.equal(f.provider.length, 1);
  assert.equal(f.provider[0].body.text.includes('private context'), false);
  assert.equal(f.provider[0].body.reply_markup.inline_keyboard[0][0].text, 'SQLite');
  assert.match(f.provider[0].body.reply_markup.inline_keyboard[0][0].callback_data, /^q:/);
});

test('a text reply answers the mapped question once and updates its receipt', async t => {
  const f = await fixture(t);
  f.setInbox([{ id: 'question', title: 'Which database?', state: 'unread', answerable: true }]);
  await f.channel.inboxOnce();
  const messageID = f.provider[0].body ? 101 : 0;
  const update = f.update('SQLite', { reply_to_message: { message_id: messageID } });
  await f.channel.receive(update); await f.channel.receive(update); await f.channel.inboxOnce();
  assert.deepEqual(f.mutations.map(x => x.body), [{ verb: 'respond', text: 'SQLite' }]);
  assert.equal(f.provider.filter(x => x.method === 'editMessageText').length, 1);
});

test('agent buttons are opaque and bind to the message and paired account', async t => {
  const f = await fixture(t);
  await f.channel.receive(f.update('/agents'));
  const button = f.provider[0].body.reply_markup.inline_keyboard[0][0];
  assert.equal(button.callback_data.includes('agent'), false);
  const callback = f.update('');
  delete callback.message;
  callback.callback_query = { id: 'callback', from: { id: 14 }, data: button.callback_data, message: { message_id: 101, chat: { id: 14, type: 'private' } } };
  await f.channel.receive(callback);
  await f.channel.receive(f.update('Run the checks'));
  assert.deepEqual(f.mutations[0].body, { to: 'agent', text: 'Run the checks' });
});

test('a reply to an agent message retains the canonical replyTo; unknown replies do not fall through', async t => {
  const f = await fixture(t);
  await f.channel.messagesOnce();
  f.setMessages([{ id: 'from-agent', from: { id: 'agent', name: 'Worker' }, to: 'owner', body: 'private result' }]);
  await f.channel.messagesOnce();
  await f.channel.receive(f.update('Continue', { reply_to_message: { message_id: 101 } }));
  assert.deepEqual(f.mutations[0].body, { text: 'Continue', replyTo: 'from-agent' });
  f.ledger.set('selected_agent', 'agent');
  await f.channel.receive(f.update('Do not reroute this', { reply_to_message: { message_id: 999 } }));
  assert.equal(f.mutations.length, 1);
});

test('agent-to-agent and extension mail do not leave; initial message snapshots are not forwarded', async t => {
  const f = await fixture(t);
  f.setMessages([{ id: 'old', from: { id: 'agent' }, to: 'owner', body: 'old result' }]);
  await f.channel.messagesOnce();
  assert.equal(f.provider.length, 0);
  f.setMessages([{ id: 'private', from: { id: 'agent' }, to: { id: 'other' } }, { id: 'extension', from: 'ext:another', to: 'owner' }]);
  await f.channel.messagesOnce();
  assert.equal(f.provider.length, 0);
});

test('paused channels and snoozed items do not send', async t => {
  const f = await fixture(t);
  f.setInbox([{ id: 'snoozed', title: 'Later', state: 'unread', snoozedUntil: '2030-01-01T00:00:00Z' }]);
  await f.channel.inboxOnce();
  assert.equal(f.provider.length, 0);
  f.channel.pause(true);
  f.setInbox([{ id: 'question', title: 'Question', state: 'unread' }]);
  await f.channel.inboxOnce();
  assert.equal(f.provider.length, 0);
});

test('uncertain core writes are never automatically replayed', async t => {
  const f = await fixture(t);
  f.ledger.set('selected_agent', 'agent');
  f.setMutationError(new ApiError(0, 'unknown', { uncertain: true }));
  const update = f.update('Run the job');
  await f.channel.receive(update); await f.channel.receive(update);
  assert.equal(f.mutations.length, 1);
  assert.equal(f.ledger.db.prepare('SELECT state FROM updates WHERE id=?').get(update.update_id).state, 'uncertain');
  assert.match(f.provider[0].body.text, /could not be confirmed/);
});

test('uncertain provider sends are not repeated by Inbox reconciliation', async t => {
  const f = await fixture(t);
  f.setInbox([{ id: 'question', title: 'Question', state: 'unread' }]);
  f.setProviderError(new ApiError(0, 'unknown', { uncertain: true }));
  await f.channel.inboxOnce(); await f.channel.inboxOnce({ snapshot: true });
  assert.equal(f.provider.length, 1);
  assert.equal(f.ledger.uncertain(), 1);
});

test('changed options cannot reuse an old choice button', async t => {
 const f = await fixture(t);
 f.setInbox([{id:'question',title:'Choose',options:['Yes','No'],state:'unread',answerable:true}]);
 await f.channel.inboxOnce();
 const button = f.provider[0].body.reply_markup.inline_keyboard[0][0];
 f.setInbox([{id:'question',title:'Choose',options:['Delete','No'],state:'unread',answerable:true}]);
 const update = f.update('');
 delete update.message;
 update.callback_query={id:'q',from:{id:14},data:button.callback_data,message:{message_id:101,chat:{id:14,type:'private'}}};
 await f.channel.receive(update);
 assert.equal(f.mutations.length,0);
});

test('pause during a read releases the update and performs no core write', async t => {
 const f = await fixture(t);
 f.setInbox([{id:'question',title:'Choose',state:'unread',answerable:true}]);
 await f.channel.inboxOnce();
 const read = f.channel.currentItem.bind(f.channel);
 f.channel.currentItem=async id => {const item=await read(id); f.channel.pause(true); return item;};
 const update=f.update('answer',{reply_to_message:{message_id:101}});
 await f.channel.receive(update);
 assert.equal(f.mutations.length,0);
 assert.equal(f.ledger.get('offset',0),0);
 f.channel.pause(false); f.channel.currentItem=read;
 await f.channel.receive(update);
 assert.equal(f.mutations.length,1);
});

test('queued output cannot reach a different pairing', async t => {
 const f=await fixture(t);
 const generation=f.ledger.get('pair').generation;
 f.channel.disconnect();
 await assert.rejects(f.channel.send('sendMessage',{chat_id:14,text:'old receipt'},generation),error=>error.code==='stale-pair');
 assert.equal(f.provider.length,0);
});

test('only an explicit owner retry makes one uncertain outbound notice eligible', async t => {
 const f=await fixture(t);
 f.setInbox([{id:'question',title:'Choose',state:'unread',answerable:true}]);
 f.setProviderError(new ApiError(0,'unknown',{uncertain:true}));
 await f.channel.inboxOnce();
 f.setProviderError(null);
 await f.channel.inboxOnce();
 assert.equal(f.provider.length,1);
 await f.channel.retryNotice();
 assert.equal(f.provider.length,2);
 assert.equal(f.mutations.length,0);
 assert.equal(f.ledger.uncertain(),0);
});

test('provider throttling retries from durable metadata even after the feed cursor advanced', async t => {
  const f = await fixture(t);
  await f.channel.messagesOnce();
  f.setMessages([{id:'from-agent',from:{id:'agent'},to:'owner',body:'result'}]);
  f.setProviderError(new ApiError(429, 'wait', {retryAfter:12}));
  await f.channel.messagesOnce();
  const cursor = f.ledger.get('messages_cursor');
  f.setProviderError(null);
  await f.channel.retryOnce();
  assert.equal(f.provider.length, 1);
  f.advance(12_000);
  await f.channel.retryOnce();
  assert.equal(f.provider.length, 2);
  assert.equal(f.ledger.delivery(f.channel.key('message','from-agent')).state, 'sent');
  assert.equal(f.ledger.get('messages_cursor'), cursor);
  assert.equal(f.mutations.length, 0);
});

test('an explicit uncertain message retry survives a known Telegram throttle', async t => {
  const f = await fixture(t);
  await f.channel.messagesOnce();
  f.setMessages([{id:'from-agent',from:{id:'agent'},to:'owner',body:'result'}]);
  f.setProviderError(new ApiError(0, 'lost response', {uncertain:true}));
  await f.channel.messagesOnce();
  f.setProviderError(new ApiError(429, 'wait', {retryAfter:2}));
  await f.channel.retryNotice();
  f.setProviderError(null); f.advance(2000);
  await f.channel.retryOnce();
  assert.equal(f.provider.length, 3);
  assert.equal(f.ledger.uncertain(), 0);
});

test('a delayed notice outside bounded history keeps a visible repair action', async t => {
  const f = await fixture(t);
  f.ledger.claimDelivery(f.channel.key('message','old'), 'message', 'old');
  f.ledger.settleDelivery(f.channel.key('message','old'), 'retry');
  await f.channel.retryOnce();
  assert.equal(f.ledger.delivery(f.channel.key('message','old')).state, 'failed');
  assert.match(f.channel.status().problem, /outside the available history/);
  assert.equal(f.provider.length, 0);
});

test('a second poller stops provider and core effects until an owner checks it', async t => {
  const f = await fixture(t);
  await f.channel.loop(async () => { f.channel.stop(); throw new ApiError(409, 'conflict'); }, 'telegram');
  f.channel.stopped = false;
  f.ledger.set('selected_agent', 'agent');
  f.setInbox([{id:'question',title:'Question',state:'unread',answerable:true}]);
  await f.channel.receive(f.update('Do work')); await f.channel.inboxOnce(); await f.channel.updatesOnce();
  assert.equal(f.provider.length, 0); assert.equal(f.mutations.length, 0);
  await f.channel.loop(async () => { f.channel.stop(); }, 'inbox');
  assert.equal(f.channel.status().state, 'error');
  f.channel.stopped = false;
  await f.channel.check(); await f.channel.receive(f.update('Do work'));
  assert.equal(f.mutations.length, 1);
});

test('invalid credentials preserve a rejected notice for retry after owner repair', async t => {
  const f = await fixture(t);
  f.setInbox([{id:'question',title:'Question',state:'unread',answerable:true}]);
  f.setProviderError(new ApiError(401, 'invalid token'));
  await f.channel.inboxOnce();
  assert.equal(f.channel.status().state, 'error');
  f.setProviderError(null);
  await f.channel.retryOnce(); assert.equal(f.provider.length, 1);
  await f.channel.check(); await f.channel.retryOnce();
  assert.equal(f.provider.length, 2);
  assert.equal(f.ledger.delivery(f.channel.key('inbox','question')).state, 'sent');
});

test('an in-flight send cannot revive old mappings or forward the next item into a new pairing', async t => {
  const f = await fixture(t);
  f.setInbox([{id:'question',title:'First',state:'unread',answerable:true}, {id:'second',title:'Second',state:'unread'}]);
  const oldKey = f.channel.key('inbox', 'question');
  const call = f.channel.bot.call;
  f.channel.bot.call = async (...args) => {
    const result = await call(...args);
    f.channel.disconnect();
    f.ledger.pair({code:f.ledger.pairingCode().code,chat:{id:15,type:'private'},user:{id:15},messageTime:1_800_000_000});
    f.channel.pause(false);
    return result;
  };
  await assert.rejects(f.channel.inboxOnce(), error => error.code === 'stale-pair');
  assert.equal(f.provider.length, 1);
  assert.equal(f.ledger.delivery(oldKey).state, 'historical');
  assert.equal(f.ledger.mapping(101), undefined);
});

test('a failed owner check blocks effects until a successful check', async t => {
  const f = await fixture(t);
  const call = f.channel.bot.call;
  let webhook = true;
  f.channel.bot.call = async (method, body) => method === 'getWebhookInfo' ? {url:webhook?'https://other.example/hook':''} : call(method, body);
  await assert.rejects(f.channel.check(), error => error.code === 'webhook-conflict');
  assert.equal(f.channel.status().state, 'error');
  assert.match(f.channel.status().problem, /webhook/);
  f.ledger.set('selected_agent', 'agent');
  await f.channel.receive(f.update('Do work'));
  assert.equal(f.mutations.length, 0);
  webhook = false; await f.channel.check(); await f.channel.receive(f.update('Do work'));
  assert.equal(f.mutations.length, 1);
});

test('a provider check in progress consumes no owner update or outbound notice', async t => {
  const f = await fixture(t);
  let release;
  const wait = new Promise(resolve => {release = resolve;});
  const call = f.channel.bot.call;
  f.channel.bot.call = async (...args) => {if(args[0] === 'getMe') await wait; return call(...args);};
  const checked = f.channel.check();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.channel.status().state, 'checking');
  assert.equal(await f.channel.receive(f.update('Do work')), false);
  assert.equal(f.ledger.get('offset',0), 0);
  assert.equal(f.provider.length, 0);
  release(); await checked;
});

test('a known core throttle releases an update until its retry deadline', async t => {
  const f = await fixture(t);
  f.ledger.set('selected_agent', 'agent');
  f.setMutationError(new ApiError(429, 'wait', {retryAfter:3}));
  const update = f.update('Do work');
  assert.equal(await f.channel.receive(update), false);
  assert.equal(f.ledger.get('offset',0), 0);
  assert.equal(f.ledger.get('updates_retry_at'), f.channel.now()+3000);
  f.setMutationError(null); f.advance(3000);
  await f.channel.receive(update);
  assert.equal(f.ledger.get('offset'), update.update_id+1);
  assert.equal(f.mutations.length, 2);
});

test('opted-in long Unicode bodies fit Telegram and announce shortening', async t => {
  const f = await fixture(t);
  f.channel.fullText = true;
  f.setInbox([{id:'question',title:'Question',body:'😀'.repeat(3000),state:'unread',answerable:true}]);
  await f.channel.inboxOnce();
  const text = f.provider[0].body.text;
  assert.ok(text.includes('😀'));
  assert.ok(text.length <= 3800);
  assert.ok(text.endsWith('…'));
  assert.equal(/[\uD800-\uDBFF]$/.test(text.slice(0,-1)), false);
});

test('an unsignalled bulk clear reconciles a sent notice once without inventing an answer', async t => {
  const f = await fixture(t);
  f.setInbox([{id:'question',title:'Question',state:'unread',answerable:true}]);
  await f.channel.inboxOnce();
  f.setInbox([]);
  await f.channel.inboxOnce({snapshot:true}); await f.channel.inboxOnce({snapshot:true});
  const edits = f.provider.filter(x => x.method === 'editMessageText');
  assert.equal(edits.length, 1);
  assert.match(edits[0].body.text, /no longer available/);
  assert.equal(edits[0].body.text.includes('Answered'), false);
  await f.channel.receive(f.update('Late answer', {reply_to_message:{message_id:101}}));
  assert.equal(f.mutations.length, 0);
});

test('a truncated snapshot cannot close a notice that is absent from its limited rows', async t => {
  const f = await fixture(t);
  f.setInbox([{id:'question',title:'Question',state:'unread',answerable:true}]);
  await f.channel.inboxOnce(); f.setInbox([]); f.setTruncated(true);
  await f.channel.inboxOnce({snapshot:true});
  assert.equal(f.provider.length, 1);
  f.setTruncated(false); await f.channel.inboxOnce({snapshot:true});
  assert.equal(f.provider.length, 2);
});

test('snooze reconciliation sends only when due and never duplicates the notice', async t => {
  const f = await fixture(t);
  f.setInbox([{id:'question',title:'Question',state:'unread',answerable:true,snoozedUntil:new Date(f.channel.now()+1000).toISOString()}]);
  await f.channel.inboxOnce(); assert.equal(f.provider.length, 0);
  f.advance(2000);
  await f.channel.inboxOnce({snapshot:true}); await f.channel.inboxOnce({snapshot:true});
  assert.equal(f.provider.length, 1);
});

test('blocked chats preserve rejected notices until an owner repairs the connection', async t => {
  const f = await fixture(t);
  f.setInbox([{id:'question',title:'Question',state:'unread',answerable:true}]);
  f.setProviderError(new ApiError(403, 'blocked'));
  await f.channel.inboxOnce();
  assert.match(f.channel.status().problem, /Unblock/);
  f.setProviderError(null); await f.channel.retryOnce(); assert.equal(f.provider.length, 1);
  await f.channel.check(); await f.channel.retryOnce(); assert.equal(f.provider.length, 2);
});

test('unsupported media offers the configured COGNIX action and performs no core write', async t => {
  const f = await fixture(t);
  const update = f.update(''); delete update.message.text;
  update.message.photo = [{file_id:'not-a-real-file'}];
  await f.channel.receive(update);
  assert.equal(f.mutations.length, 0);
  assert.match(f.provider[0].body.text, /Only text/);
  assert.equal(f.provider[0].body.reply_markup.inline_keyboard[0][0].url, 'https://cognix.example/#/');
});

test('full-text forwarding requires the literal saved boolean true', async t => {
  const f = await fixture(t);
  const request = f.channel.host.request;
  for (const value of [undefined, null, false, 'false', 'true', 1, {}, []]) {
    f.channel.host.request = async (path, body) => path.endsWith('/settings') ? {values:{full_text:value},secrets:{bot_token:'token'}} : request(path, body);
    await f.channel.configure(); assert.equal(f.channel.fullText, false);
  }
  f.channel.host.request = async (path, body) => path.endsWith('/settings') ? {values:{full_text:true},secrets:{bot_token:'token'}} : request(path, body);
  await f.channel.configure(); assert.equal(f.channel.fullText, true);
});

test('a failed host read is not diagnosed as a rejected Telegram token',async t=>{
  const f=await fixture(t);
  f.channel.host={request:async()=>{throw new ApiError(401,'PRIVATE_CANARY');}};
  await assert.rejects(f.channel.check());
  assert.equal(f.channel.status().problemCode,'host-refused');
  assert(!f.channel.status().problem.includes('PRIVATE_CANARY'));
});
test('unsupported hosts are refused before fetching protected settings',async t=>{
  const f=await fixture(t);let settings=0;
  f.channel.host={request:async path=>{if(path.endsWith('/settings'))settings++;return {channelProtocol:0};}};
  await assert.rejects(f.channel.check());
  assert.equal(settings,0);assert.equal(f.channel.status().problemCode,'host-incompatible');
});
test('missing token is an actionable setup step and successful check clears the old error',async t=>{
  const f=await fixture(t);
  f.channel.setProblem(new ApiError(401,'PRIVATE_CANARY'));
  f.channel.host={request:async path=>path.endsWith('/me')?{channelProtocol:1,channel:{name:'Telegram'},restoreGeneration:''}:{secrets:{},values:{}}};
  await f.channel.check();assert.equal(f.channel.status().state,'needs-token');assert.equal(f.channel.status().problem,'');assert.equal(f.channel.status().problemCode,'');
});
