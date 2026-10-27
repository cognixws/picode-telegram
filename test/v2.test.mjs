import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../server/ledger.mjs';
import {Channel} from '../server/channel.mjs';
import {ApiError,jsonRequest} from '../server/http.mjs';
import {createServer} from '../server/server.mjs';

const digest = text=>createHash('sha256').update(text).digest('hex');
const deferred = ()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function fixture(t, {topics=false}={}) {
  const folder=mkdtempSync(join(tmpdir(),'telegram-v2-')), path=join(folder,'data.db');
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const db=new DatabaseSync(path);
  for (const migration of ['001_ledger.sql','002_channels_v2.sql','003_private_topics.sql']) db.exec(readFileSync(new URL('../migrations/'+migration,import.meta.url),'utf8'));
  db.close();
  let now=1800000000000,fullText=true,providerError,hostFailure,replyAllowed=true,gate;
  const ledger=new Ledger(path,{now:()=>now});t.after(()=>ledger.close());
  const writes=[],provider=[];let session='',hostGeneration='generation-1',messages=[],cursor=1;
  let assistants=[{id:'as-a',name:'Assistant A',revision:1,generation:hostGeneration},{id:'as-b',name:'Assistant B',revision:1,generation:hostGeneration}];
  const host={request:async(path,body)=>{
    if(path==='/api/ext/v1/me') return {channelProtocol:2,restoreGeneration:'',channel:{name:'Telegram'}};
    if(path==='/api/ext/v1/settings') return {values:{full_text:fullText},secrets:{bot_token:'SYNTHETIC_NOT_A_REAL_TOKEN'}};
    if(path==='/api/ext/v2/channel/session') {
      if(hostFailure) throw hostFailure;
      if(session && session!==body.session) hostGeneration='generation-2';
      session=body.session; return {connection:{generation:hostGeneration,paired:body.paired,paused:body.paused}};
    }
    if(path==='/api/ext/v2/assistants') return {assistants,textEnabled:fullText};
    if(path==='/api/ext/v2/assistants/replies/check') return {allowed:replyAllowed};
    if(path.startsWith('/api/ext/v2/assistants/topics?')) return {topics:[{id:'t-1',name:'Jingle ideas',state:'open'},{id:'t-2',name:'trip',state:'open'}]};
    if(path==='/api/ext/v1/agents') return {agents:[{id:'cli',name:'CLI Worker',running:true}]};
    if(path.startsWith('/api/ext/v1/messages')) {
      if(body) {writes.push({path,body});return {message:{id:'cli-input',state:'delivered'}};}
      return {messages,cursor:cursor++};
    }
    if(path.startsWith('/api/ext/v1/inbox')) return {items:[],cursor:cursor++};
    if(path==='/api/ext/v2/assistants/messages') {writes.push({path,body});return {message:{id:'input-'+writes.length,state:'pending'}};}
    throw Error('Unexpected fixture route');
  }};
  const bot={call:async(method,body)=>{
    if(method==='getMe') return {id:91,username:'fixture_bot',...(topics?{has_topics_enabled:true}:{})};
    if(method==='getWebhookInfo') return {url:''};
    if(gate) await gate.promise;
    provider.push({method,body:structuredClone(body)});
    if(providerError) throw providerError;
    if(method==='createForumTopic') return {message_thread_id:700+provider.length,name:body.name};
    return {message_id:100+provider.length};
  }};
  const c=new Channel({ledger,host,makeBot:()=>bot,now:ledger.now,spacing:0});await c.configure();
  const chat={id:14,type:'private'},from={id:14};
  ledger.pair({code:ledger.pairingCode().code,chat,user:from,messageTime:now/1000});await c.v2.sync();
  let updateID=1;
  const update=(text,extra={})=>({update_id:updateID++,message:{message_id:updateID,date:now/1000,chat,from,text,...extra}});
  const callback=(handle,messageID)=>({update_id:updateID++,callback_query:{id:'callback',data:handle,from,message:{message_id:messageID,date:now/1000,chat}}});
  return {c,ledger,provider,writes,path,update,callback,
    operation:(id='op-1',text='Tool text')=>({operation:id,text,session:c.v2.session(),payloadHash:digest(text)}),
    select:kind=>ledger.selectTarget({kind,id:kind==='assistant'?'as-a':'cli',generation:ledger.get('host_generation'),revision:kind==='assistant'?1:0}),
    setText:x=>{fullText=x;},setProviderError:x=>{providerError=x;},setHostFailure:x=>{hostFailure=x;},setAllowed:x=>{replyAllowed=x;},setGate:x=>{gate=x;},setMessages:x=>{messages=x;},setAssistants:x=>{assistants=x;},advance:n=>{now+=n;}};
}

test('API4 manifest declares only reviewed transport doors and protected text setting',()=>{
 const m=JSON.parse(readFileSync(new URL('../picode-extension.json',import.meta.url)));
 assert.equal(m.apiVersion,4);assert.equal(m.channel.protocol,2);
 assert.deepEqual(m.channel,{name:'Telegram',statusPath:'/status',protocol:2,sendPath:'/v2/send',receiptPath:'/v2/receipt',textSetting:'full_text'});
 assert.deepEqual(m.permissions,['agents:read','inbox:read','inbox:answer','messages:read','messages:owner','channels:send','assistants:read','assistants:message']);
 assert.equal(m.settings.find(x=>x.key==='full_text').default,false);
});

test('concurrent exact operation keys cause one provider effect; receipt is read only',async t=>{
 const f=await fixture(t),gate=deferred();f.setGate(gate);
 const op=f.operation(),first=f.c.v2.send(op);
 await new Promise(r=>setImmediate(r));
 const duplicate=await f.c.v2.send(op);assert.equal(duplicate.state,'uncertain');
 assert.equal(f.c.v2.receipt(op).state,'uncertain');gate.resolve();
 assert.equal((await first).state,'sent');
 for(let n=0;n<5;n++) assert.equal((await f.c.v2.send(op)).state,'sent');
 assert.equal(f.c.v2.receipt(op).state,'sent');assert.equal(f.provider.length,1);
 assert.equal(f.provider[0].body.chat_id,14);
 await assert.rejects(f.c.v2.send({...op,text:'changed',payloadHash:digest('changed')}),e=>e.status===409);
 assert.throws(()=>f.c.v2.receipt({...op,session:'f'.repeat(64)}),e=>e.status===409);
 assert.equal(f.provider.length,1);
});

test('unknown provider effect stays uncertain across exact retry, restore, repair and restart',async t=>{
 const f=await fixture(t),op=f.operation();f.setProviderError(new ApiError(0,'lost',{uncertain:true}));
 assert.equal((await f.c.v2.send(op)).state,'uncertain');f.setProviderError(null);
 assert.equal((await f.c.v2.send(op)).state,'uncertain');assert.equal(f.provider.length,1);
 f.ledger.restoreGeneration('restored');f.ledger.prune();
 assert.equal((await f.c.v2.send(op)).state,'uncertain');assert.equal(f.provider.length,1);
 const reopened=new Ledger(f.path);t.after(()=>reopened.close());
 assert.equal(reopened.operation(op.operation).state,'uncertain');
 assert.equal(readFileSync(f.path).includes(Buffer.from(op.text)),false);
});

test('dispatching ledger recovery never turns into a provider retry; confirmed history survives pairing changes',async t=>{
 const f=await fixture(t),op=f.operation();f.ledger.claimOperation(op.operation,op.session,op.payloadHash);
 const reopened=new Ledger(f.path);t.after(()=>reopened.close());
 assert.equal(reopened.operation(op.operation).state,'uncertain');assert.equal((await f.c.v2.send(op)).state,'uncertain');
 f.ledger.unpair();assert.equal(f.ledger.operation(op.operation).state,'uncertain');assert.equal(f.provider.length,0);
});

test('known 429 is terminal for this tool operation; a fresh identity respects retry_after',async t=>{
 const f=await fixture(t),op=f.operation();f.setProviderError(new ApiError(429,'wait',{retryAfter:10}));
 assert.equal((await f.c.v2.send(op)).state,'refused');f.setProviderError(null);
 assert.equal((await f.c.v2.send(op)).state,'refused');
 assert.equal((await f.c.v2.send(f.operation('op-2'))).state,'refused');assert.equal(f.provider.length,1);
 f.advance(10000);assert.equal((await f.c.v2.send(f.operation('op-3'))).state,'sent');assert.equal(f.provider.length,2);
});

test('tool text off, stale session, long text, paused and busy queue refuse without effects',async t=>{
 const f=await fixture(t);f.setText(false);
 assert.equal((await f.c.v2.send(f.operation('off'))).state,'refused');assert.equal(f.ledger.get('chat_blocked',false),false);
 f.setText(true);
 assert.equal((await f.c.v2.send({...f.operation('stale'),session:'a'.repeat(64)})).state,'refused');
 assert.equal((await f.c.v2.send(f.operation('long','😀'.repeat(2049)))).state,'refused');
 f.c.pause(true);await f.c.v2.sync();assert.equal((await f.c.v2.send(f.operation('paused'))).state,'refused');
 f.c.pause(false);await f.c.v2.sync();
 const gate=deferred();f.setGate(gate);const first=f.c.notice('Existing notice');await new Promise(r=>setImmediate(r));
 assert.equal((await f.c.v2.send(f.operation('busy'))).state,'refused');gate.resolve();await first;
 assert.equal(f.provider.length,1);
});

test('text consent is rechecked after a queued Assistant reply and Inbox body wait',async t=>{
 const f=await fixture(t),gate=deferred();f.c.sendChain=gate.promise;
 const response={id:'response',to:'owner',from:{id:'as-a',name:'Assistant A',kind:'assistant'},replyTo:'input',body:'PRIVATE_ASSISTANT_BODY'};
 const reply=f.c.forwardMessage(response);
 const inbox=f.c.forwardInbox({id:'question',title:'Title',body:'PRIVATE_INBOX_BODY',state:'unread',answerable:true});
 await new Promise(r=>setImmediate(r));f.setText(false);gate.resolve();await Promise.all([reply,inbox]);
 assert.equal(f.provider.length,1);assert.equal(f.provider[0].body.text.includes('Title'),true);
 assert.equal(JSON.stringify(f.provider).includes('PRIVATE_'),false);assert.equal(f.ledger.get('chat_blocked',false),false);
 assert.equal(f.ledger.delivery(f.c.key('assistant','response')).state,'failed');
});

test('queued Assistant response rechecks revoked admission and never becomes a local history subscription',async t=>{
 const f=await fixture(t),gate=deferred();f.c.sendChain=gate.promise;
 const reply=f.c.forwardMessage({id:'response',to:'owner',from:{kind:'assistant'},body:'LOCAL_HISTORY'});
 f.setAllowed(false);gate.resolve();await reply;assert.equal(f.provider.length,0);
 assert.equal(f.ledger.get('chat_blocked',false),false);
});

test('one typed picker invalidates interleaved old callbacks and replaces either target',async t=>{
 const f=await fixture(t),a=await f.c.v2.choose('agent');const old=a.keyboard[0][0].callback_data;f.ledger.bindHandle(old,10);
 const b=await f.c.v2.choose('assistant');const fresh=b.keyboard[0][0].callback_data;f.ledger.bindHandle(fresh,11);
 await assert.rejects(f.c.v2.select(old,10,f.ledger.get('pair').generation),e=>e.status===409);
 await f.c.v2.select(fresh,11,f.ledger.get('pair').generation);assert.equal(f.ledger.get('selected_target').kind,'assistant');
 const c=await f.c.v2.choose('agent');const next=c.keyboard[0][0].callback_data;f.ledger.bindHandle(next,12);
 await f.c.v2.select(next,12,f.ledger.get('pair').generation);assert.equal(f.ledger.get('selected_target').kind,'agent');
 assert.equal(f.ledger.get('selected_agent'),null);
 await assert.rejects(f.c.v2.select(fresh,11,f.ledger.get('pair').generation),e=>e.status===409);
 f.advance(600001);const d=await f.c.v2.choose('assistant'),expired=d.keyboard[0][0].callback_data;f.ledger.bindHandle(expired,13);f.advance(600001);
 await assert.rejects(f.c.v2.select(expired,13,f.ledger.get('pair').generation),e=>e.status===409);
});

test('Assistant Reply uses canonical binding over selected CLI and unknown Reply never falls through',async t=>{
 const f=await fixture(t);f.select('agent');
 f.ledger.claimDelivery('bound','assistant','as-a-response');f.ledger.settleDelivery('bound','sent',50);
 const update=f.update('Continue A',{reply_to_message:{message_id:50}});await f.c.receive(update);
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].path,'/api/ext/v2/assistants/messages');
 assert.equal(f.writes[0].body.replyTo,'as-a-response');assert.equal(f.writes[0].body.assistant,undefined);
 assert.match(f.writes[0].body.requestId,/^tg-\d+-\d+$/);
 await f.c.receive(update);assert.equal(f.writes.length,1);
 await f.c.receive(f.update('Unknown',{reply_to_message:{message_id:999}}));assert.equal(f.writes.length,1);
});

test('explicit Assistant selection starts a scoped stable input; text-off refuses it and directory remains usable',async t=>{
 const f=await fixture(t);f.select('assistant');
 await f.c.receive(f.update('Ask A'));assert.equal(f.writes.length,1);
 assert.equal(f.writes[0].body.assistant,'as-a');assert.equal(f.writes[0].body.generation,'generation-1');assert.equal(f.writes[0].body.revision,1);
 assert.deepEqual(f.ledger.pendingInputs(),['input-1']);
 f.setText(false);await f.c.receive(f.update('Must not enter'));assert.equal(f.writes.length,1);
 const picker=await f.c.v2.choose('assistant');assert.match(picker.text,/Include message text/);
 assert.equal((await f.c.v2.send(f.operation())).state,'refused');
});

test('only pending admitted Assistant responses reconcile startup/reset snapshots; V1 history stays context',async t=>{
 const f=await fixture(t);f.select('assistant');await f.c.receive(f.update('Ask A'));f.provider.length=0;
 f.setMessages([{id:'cli-history',to:'owner',from:{id:'cli'},body:'OLD_CLI'},{id:'local',to:'owner',from:{kind:'assistant'},body:'LOCAL_UNBOUND'},{id:'answer',to:'owner',from:{id:'as-a',kind:'assistant'},replyTo:'input-1',body:'ANSWER_A'}]);
 await f.c.messagesOnce();await f.c.reconcileOnce();
 assert.equal(f.provider.length,1);assert.match(f.provider[0].body.text,/ANSWER_A/);assert.equal(JSON.stringify(f.provider).includes('OLD_CLI'),false);assert.deepEqual(f.ledger.pendingInputs(),[]);
});

test('unknown session synchronization blocks effects until confirmation and stable session does not change on restart',async t=>{
 const f=await fixture(t),session=f.c.v2.session();f.c.pause(false);f.setHostFailure(new ApiError(0,'lost',{uncertain:true}));
 await assert.rejects(f.c.v2.sync());assert.equal(f.c.connectionBlocked(),true);
 f.select('agent');assert.equal(await f.c.receive(f.update('Must wait')),false);assert.equal(f.writes.length,0);
 f.setHostFailure(null);await f.c.v2.sync();assert.equal(f.c.connectionBlocked(),false);await f.c.configure();assert.equal(f.c.v2.session(),session);
 await f.c.receive(f.update('Now admitted'));assert.equal(f.writes.length,1);
});

test('V2 HTTP process routes need proxy authority and accept bounded JSON envelopes',async t=>{
 const f=await fixture(t),server=createServer(f.c,{secret:'fixture-proxy-authority',verify:async()=>{}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=new URL(`http://127.0.0.1:${server.address().port}`),headers={'X-PiCode-Proxy-Secret':'fixture-proxy-authority'};
 await assert.rejects(jsonRequest(new URL('/v2/send',base),{method:'POST',body:f.operation()}),e=>e.status===401);
 const send=await jsonRequest(new URL('/v2/send',base),{method:'POST',headers,body:f.operation()});assert.equal(send.state,'sent');
 const read=await jsonRequest(new URL('/v2/receipt',base),{method:'POST',headers,body:f.operation()});assert.equal(read.state,'sent');assert.equal(f.provider.length,1);
 const long=await jsonRequest(new URL('/v2/send',base),{method:'POST',headers,body:f.operation('long-envelope','x'+'\n'.repeat(16383))});assert.equal(long.state,'refused');assert.equal(f.provider.length,1);
});

test('independent legacy domain writer upgrades selection once and keeps history; restored V2 effects never replay',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'telegram-independent-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const path=join(folder,'data.db'),db=new DatabaseSync(path);
 db.exec(readFileSync(new URL('fixtures/legacy-ledger.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('../migrations/002_channels_v2.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('../migrations/003_private_topics.sql',import.meta.url),'utf8'));
 // Fixed recovered row, not produced by claimOperation/finishOperation.
 db.prepare("INSERT INTO operations VALUES(?,?,?,'dispatching',NULL,1800000000000)").run('recovered-op','a'.repeat(64),'b'.repeat(64));db.close();
 const ledger=new Ledger(path);t.after(()=>ledger.close());
 const channel=new Channel({ledger,host:{request:async()=>({connection:{generation:'host-gen'}})},makeBot:()=>{throw Error('No provider effects');}});
 channel.protocol=2;channel.bot={};await channel.v2.sync();
 assert.deepEqual(ledger.get('selected_target'),{kind:'agent',id:'cli',generation:'host-gen',revision:0});assert.equal(ledger.get('selected_agent'),null);
 assert.equal(ledger.mapping(77).source_id,'v1-message');assert.equal(ledger.operation('recovered-op').state,'uncertain');
 ledger.restoreGeneration('new-restore');ledger.prune();
 assert.equal(ledger.get('pair'),null);assert.equal(ledger.get('selected_target'),null);assert.equal(ledger.mapping(77),undefined);
 assert.equal(ledger.claimOperation('recovered-op','a'.repeat(64),'b'.repeat(64)),false);
 assert.equal(channel.v2.receipt({operation:'recovered-op',session:'a'.repeat(64),payloadHash:'b'.repeat(64)}).state,'uncertain');
 assert.equal(ledger.operation('recovered-op').state,'uncertain');
});


test('a slow consent check cannot actuate a tool operation past its bounded dispatch window',async t=>{
 const f=await fixture(t),gate=deferred(),request=f.c.host.request;
 f.c.host.request=async(path,body)=>{if(path==='/api/ext/v1/settings') await gate.promise;return request(path,body);};
 const pending=f.c.v2.send(f.operation());await new Promise(r=>setImmediate(r));f.advance(19000);gate.resolve();
 assert.equal((await pending).state,'refused');assert.equal(f.provider.length,0);
});


test('full input ledger refuses BEFORE host execution; accepted canonical input binds the reserved row',async t=>{
 const f=await fixture(t);f.select('assistant');
 const insert=f.ledger.db.prepare("INSERT INTO deliveries(key,kind,source_id,state,changed_at) VALUES(?,'input','','awaiting',0)");
 f.ledger.transaction(()=>{for(let n=0;n<10000;n++) insert.run('capacity-'+n);});
 await assert.rejects(f.c.v2.input(f.update('Must not execute'),'Must not execute',f.ledger.get('pair').generation),e=>e.code==='ledger-full');
 assert.equal(f.writes.length,0);assert.equal(f.provider.length,0);
});

test('temporary pre-provider host verification failure retains a known-no-effect reply retry',async t=>{
 const f=await fixture(t),request=f.c.host.request;
 const message={id:'response',to:'owner',from:{id:'as-a',kind:'assistant'},replyTo:'input',body:'ANSWER_AFTER_RECOVERY'};
 f.c.host.request=async(path,body)=>{if(path==='/api/ext/v1/settings') throw new ApiError(503,'temporary');return request(path,body);};
 await f.c.forwardMessage(message);assert.equal(f.provider.length,0);
 assert.equal(f.ledger.delivery(f.c.key('assistant','response')).state,'retry');
 f.c.host.request=request;f.setMessages([message]);f.advance(6000);await f.c.retryOnce();
 assert.equal(f.provider.length,1);assert.equal(f.ledger.delivery(f.c.key('assistant','response')).state,'sent');
 await f.c.retryOnce();assert.equal(f.provider.length,1);
});


test('post-effect ledger failures retain uncertainty instead of inviting a repeated Assistant input or tool send',async t=>{
 const f=await fixture(t);f.select('assistant');
 f.ledger.bindInput=()=>{throw Error('synthetic metadata failure');};
 const update=f.update('Accepted once');
 await assert.rejects(f.c.v2.input(update,'Accepted once',f.ledger.get('pair').generation),e=>e.uncertain===true);
 assert.equal(f.writes.length,1);
 await assert.rejects(f.c.v2.input(update,'Accepted once',f.ledger.get('pair').generation),e=>e.uncertain===true);assert.equal(f.writes.length,1);
 const finish=f.ledger.finishOperation.bind(f.ledger);let failed=false;
 f.ledger.finishOperation=(id,state,...args)=>{if(state==='sent' && !failed){failed=true;throw Error('synthetic receipt failure');}return finish(id,state,...args);};
 const op=f.operation();assert.equal((await f.c.v2.send(op)).state,'uncertain');
 assert.equal((await f.c.v2.send(op)).state,'uncertain');assert.equal(f.provider.length,1);
});

test('empty Assistant picker guides to the sole Channels tool setting',async t=>{
 const f=await fixture(t);f.setAssistants([]);
 const picker=await f.c.v2.choose('assistant');
 assert.match(picker.text,/enable Channels in its tools/);
 assert.doesNotMatch(picker.text,/workspace|Telegram access|admitted/);
});

test('tool lifecycle revision is opaque and stale picker cannot survive a switch change',async t=>{
 const f=await fixture(t);
 f.setAssistants([{id:'as-a',name:'Assistant A',revision:-2,generation:'generation-1'}]);
 const picker=await f.c.v2.choose('assistant');
 const callback=picker.keyboard[0][0].callback_data;
 // Bind the callback to its actual provider message just as Channel.sendNotice does.
 f.ledger.bindHandle(callback,800);
 await f.c.v2.select(callback,800,f.ledger.get('pair').generation);
 await f.c.receive(f.update('Negative revision input'));
 assert.equal(f.writes[0].body.revision,-2);
 const second=await f.c.v2.choose('assistant');
 f.ledger.bindHandle(second.keyboard[0][0].callback_data,801);
 f.setAssistants([{id:'as-a',name:'Assistant A',revision:-4,generation:'generation-1'}]);
 await assert.rejects(f.c.v2.select(second.keyboard[0][0].callback_data,801,f.ledger.get('pair').generation),/current target/);
});

// Private-chat topics (ADR-0376 T4b): a known topic of the chosen Assistant
// marks the input with its slug and the answer returns there; a topic made in
// Telegram is learned from its service message; /topics offers the
// Assistant's topics and a button opens one (once).
const topicMessage=(text,thread,extra={})=>({message_thread_id:thread,is_topic_message:true,reply_to_message:{message_id:thread,forum_topic_created:{name:'x'}},...extra});
test('a message in a private-chat topic goes to that topic and is answered there',async t=>{
 const f=await fixture(t,{topics:true});f.select('assistant');
 await f.c.receive(f.update('',{message_thread_id:55,is_topic_message:true,forum_topic_created:{name:'Jingle ideas'}}));
 assert.deepEqual({...f.ledger.thread(55)},{assistant:'as-a',slug:'jingle-ideas'});
 await f.c.receive(f.update('make it shorter',topicMessage('',55)));
 const write=f.writes.at(-1);
 assert.equal(write.path,'/api/ext/v2/assistants/messages');assert.equal(write.body.text,'#jingle-ideas make it shorter','the topic root is not a reply');
 assert.equal(f.provider.at(-1).body.message_thread_id,55,'the receipt is in the topic');
 await f.c.receive(f.update('#1 priority today',topicMessage('',55)));
 assert.equal(f.writes.at(-1).body.text,'#jingle-ideas #1 priority today','a # that is not the mark still goes to the topic');
 await f.c.receive(f.update('#jingle-ideas again',topicMessage('',55)));
 assert.equal(f.writes.at(-1).body.text,'#jingle-ideas again','its own mark is not doubled');
 await f.c.receive(f.update('no topic here'));
 assert.equal(f.writes.at(-1).body.text,'no topic here');
 assert.equal(f.provider.at(-1).body.message_thread_id,undefined);
 // The Assistant's answer to the topic's input returns to the topic.
 const input=f.ledger.db.prepare('SELECT message_id FROM input_threads ORDER BY created_at LIMIT 1').get().message_id;
 await f.c.forwardMessage({id:'answer-1',to:'owner',from:{kind:'assistant',name:'CTO'},body:'Shorter now.',replyTo:input});
 assert.equal(f.provider.at(-1).body.message_thread_id,55);
 // Another Assistant chosen since: the topic's mark is not sent to it.
 f.ledger.selectTarget({kind:'assistant',id:'as-b',generation:f.ledger.get('host_generation'),revision:1});
 await f.c.receive(f.update('for B',topicMessage('',55)));
 assert.equal(f.writes.at(-1).body.text,'for B');
});

test('/topics needs Threaded Mode and an Assistant, then opens a topic once',async t=>{
 const off=await fixture(t);off.select('assistant');
 await off.c.receive(off.update('/topics'));
 assert.match(off.provider.at(-1).body.text,/Threaded Mode/);
 const f=await fixture(t,{topics:true});
 await f.c.receive(f.update('/topics'));
 assert.match(f.provider.at(-1).body.text,/Choose an Assistant/);
 f.select('assistant');
 await f.c.receive(f.update('/topics'));
 const keyboard=f.provider.at(-1).body.reply_markup.inline_keyboard;
 assert.deepEqual(keyboard.map(r=>r[0].text),['#jingle-ideas','#trip']);
 for (const r of keyboard) assert.ok(Buffer.byteLength(r[0].callback_data)<=64,'callback_data fits Telegram');
 const trip=keyboard[1][0].callback_data,sentID=f.provider.length+100;
 await f.c.receive(f.callback(trip,sentID));
 const made=f.provider.find(p=>p.method==='createForumTopic');
 assert.equal(made.body.name,'trip');
 const thread=f.ledger.threadOf('as-a','trip');assert.ok(thread>0);
 assert.equal(f.provider.at(-1).body.message_thread_id,thread,'the first line is in the new topic');
 await f.c.receive(f.callback(trip,sentID));
 assert.equal(f.provider.filter(p=>p.method==='createForumTopic').length,1,'an open topic is not made twice');
 await f.c.receive(f.callback('p:forged-handle',sentID));
 assert.equal(f.provider.filter(p=>p.method==='createForumTopic').length,1,'a handle of no current topic is refused');
 // A topic deleted in Telegram is made again.
 f.setProviderError(Object.assign(new ApiError(400,'Bad Request: message thread not found'),{status:400}));
 const before=f.provider.length;
 const once=f.c.v2.openTopic(trip.slice(2),f.ledger.get('pair').generation);
 await assert.rejects(once);f.setProviderError(null);
 assert.equal(f.ledger.threadOf('as-a','trip'),0,'the deleted thread is forgotten');
 assert.ok(f.provider.length>before);
});

test('long names give buttons Telegram accepts',async t=>{
 const f=await fixture(t,{topics:true});f.select('assistant');
 f.c.v2.slugs=async()=>['маркетинг-и-продажи-новых-продукт','日本語のトピックとてもながいなまえ'];
 await f.c.receive(f.update('/topics'));
 for (const r of f.provider.at(-1).body.reply_markup.inline_keyboard) assert.ok(Buffer.byteLength(r[0].callback_data)<=64);
});
