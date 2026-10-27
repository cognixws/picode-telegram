import { createHash } from 'node:crypto';
import { ApiError } from './http.mjs';
import { topicSlug } from './channel.mjs';

// topicHandle is a short, stable handle of an Assistant's topic for a button.
const topicHandle = (assistant, slug) => createHash('sha256').update(assistant + '\0' + slug).digest('base64url').slice(0, 16);

const hash = text => createHash('sha256').update(text).digest('hex');
const identity = text => typeof text === 'string' && /^[\x21-\x7e]{1,128}$/.test(text);
const hex = text => typeof text === 'string' && /^[a-f0-9]{64}$/.test(text);
const enabledMessage = 'Turn on Include message text in the Telegram extension settings in COGNIX.';

// V2 is independent of V1's retryable notices. No operation carries a caller-
// supplied provider recipient; the current paired chat is the only destination.
export class ChannelV2 {
  constructor(channel) { this.channel = channel; this.sessionSync = Promise.resolve(); this.blocked = false; }
  get ledger() { return this.channel.ledger; }
  get enabled() { return this.channel.protocol === 2; }
  session() { const pair = this.ledger.get('pair'); return pair ? hash(pair.generation) : ''; }
  sync() {
    if (!this.enabled) return Promise.resolve();
    const run = async () => {
      const session = this.session(), paired = !!session;
      const paused = this.ledger.get('paused', false) || !this.channel.bot;
      const result = await this.channel.host.request('/api/ext/v2/channel/session', {session,paired,paused});
      // An old async registration cannot publish a new local selection context.
      if (session !== this.session() || paused !== (this.ledger.get('paused',false) || !this.channel.bot)) throw new ApiError(409,'This pairing changed.',{code:'stale-pair'});
      if (!result.connection?.generation) throw new ApiError(409,'The channel session could not be confirmed.');
      const generation = result.connection.generation;
      const previous = this.ledger.get('host_generation');
      this.ledger.set('host_generation', generation);
      if (previous && previous !== generation) {
        this.ledger.newPicker();
        this.ledger.set('selected_target', null);
      }
      // One-time migration of V1 selection; no simultaneous implicit targets.
      const legacy = this.ledger.get('selected_agent');
      if (paired && legacy && !this.ledger.get('selected_target')) this.ledger.selectTarget({kind:'agent',id:legacy,generation,revision:0});
    };
    const pending = this.sessionSync.then(run,run).then(() => { this.blocked=false; this.channel.errors.delete('session'); },error => { this.blocked=true; this.channel.errors.set('session','The channel session could not be confirmed. Check the connection in COGNIX.'); throw error; });
    this.sessionSync = pending.catch(() => {});
    return pending;
  }
  async textEnabled() {
    const result = await this.channel.hostRead('/api/ext/v1/settings');
    this.channel.fullText = result.values?.full_text === true;
    return this.channel.fullText;
  }
  async requireText() {
    if (!await this.textEnabled()) throw new ApiError(403,enabledMessage,{code:'text-disabled'});
  }
  async directory() {
    await this.sync();
    return this.channel.host.request('/api/ext/v2/assistants');
  }
  async choose(kind, text) {
    await this.sync();
    const generation = this.ledger.get('host_generation');
    const picker = this.ledger.newPicker();
    let items;
    if (kind === 'assistant') {
      const result = await this.directory();
      if (!result.textEnabled) return {text:enabledMessage};
      items = result.assistants || [];
    } else items = await this.channel.agents();
    if (!items.length) return {text:kind === 'assistant' ? 'No Assistants have Channels enabled. Open an Assistant in COGNIX, enable Channels in its tools, and save.' : 'No agents are running. Open COGNIX to start one.'};
    // A concurrent picker opening invalidates this keyboard rather than mixing slots.
    if (picker !== this.ledger.get('picker_revision')) throw new ApiError(409,'Open the picker again.');
    const selected = this.ledger.get('selected_target');
    const current = selected && selected.generation === generation && items.find(item=>item.id===selected.id && kind===selected.kind);
    const keyboard = items.slice(0,20).map(item => [{text:String(item.name || 'Unnamed').slice(0,60),callback_data:this.ledger.targetButton({kind,id:item.id,generation,revision:kind==='assistant'?item.revision:0},picker)}]);
    return {text:(text || `Choose an ${kind === 'assistant' ? 'Assistant' : 'agent'} for your messages.`) + (current ? ` Current: ${current.name}.` : ''),keyboard};
  }
  async select(handle, telegramID, pairGeneration) {
    await this.sync();
    const target = this.ledger.resolveTarget(handle,telegramID,this.ledger.get('host_generation'));
    if (!target) throw new ApiError(409,'This picker expired.');
    const items = target.kind === 'assistant' ? (await this.directory()).assistants || [] : await this.channel.agents();
    const item = items.find(item=>item.id===target.id && (target.kind!=='assistant' || item.revision===target.revision && item.generation===target.generation));
    this.channel.assertActive(pairGeneration);
    // Recheck after reads: another picker/selection may have invalidated the handle.
    if (!item || !this.ledger.resolveTarget(handle,telegramID,target.generation)) throw new ApiError(409,'Choose a current target again.');
    this.ledger.selectTarget(target);
    return {text:`Messages will go to ${target.kind==='assistant'?'Assistant':'agent'} ${item.name}. Reply keeps the original conversation.`};
  }
  async input(update, text, pairGeneration, replyTo = '', thread = 0) {
    await this.requireText();
    await this.sync();
    // A message in a known topic of the chosen Assistant goes to that topic
    // with a leading "#slug", the owner's own mark (ADR-0376 row 1), unless it
    // already leads with that mark: the core reads one mark, so "#1 …" in a
    // topic still goes to the topic. A reply keeps its own binding.
    const known = thread ? this.ledger.thread(thread) : null;
    const chosen = this.ledger.get('selected_target');
    const slug = known && chosen?.kind === 'assistant' && known.assistant === chosen.id ? known.slug : '';
    if (slug && !replyTo && !new RegExp('^#' + slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s').test(text)) text = `#${slug} ${text}`;
    const target = this.ledger.get('selected_target');
    if (!replyTo && (!target || target.kind!=='assistant' || target.generation!==this.ledger.get('host_generation'))) throw new ApiError(409,'Choose an Assistant again.');
    if (Buffer.byteLength(text)>16*1024) throw new ApiError(400,'This message is too long.');
    const body = {text,requestId:`tg-${this.ledger.epoch()}-${update.update_id}`};
    if (replyTo) body.replyTo = replyTo;
    else Object.assign(body,{assistant:target.id,generation:target.generation,revision:target.revision});
    // Reserve bounded durable capacity BEFORE the host can execute an input.
    // The canonical ID is bound into that row without inserting after effect.
    const key = this.channel.key('input',body.requestId);
    if (!this.ledger.claimDelivery(key,'input','')) throw new ApiError(409,'This input already has a receipt. Check COGNIX.',{uncertain:true});
    let result, accepted=false;
    try {
      result = await this.channel.hostWrite('/api/ext/v2/assistants/messages',body,pairGeneration);
      accepted=true;
      const id = result.message?.id;
      if (!identity(id)) throw new ApiError(502,'The input receipt could not be confirmed.',{uncertain:true});
      this.ledger.bindInput(key,id);
      if (thread) this.ledger.bindInputThread(id,thread);
    } catch (error) {
      if (accepted) error.uncertain=true;
      try { this.ledger.settleDelivery(key,error.uncertain?'uncertain':error.status===429 || error.code==='paused'?'retry':'failed'); } catch { error.uncertain=true; }
      throw error;
    }
    return {...this.channel.sentReceipt(result),receiptKind:'assistant-receipt'};
  }
  // topics lists the chosen Assistant's topics as buttons; one opens it as a
  // topic of this private chat (ADR-0376 T4b).
  async topics() {
    await this.sync();
    if (!this.channel.topicsEnabled) return {text:'Turn on Threaded Mode for your bot in @BotFather to use topics here, then try /topics again.'};
    const target = this.ledger.get('selected_target');
    if (!target || target.kind!=='assistant' || target.generation!==this.ledger.get('host_generation')) return {text:'Choose an Assistant with /assistants first.'};
    await this.requireText();
    const keyboard = (await this.slugs(target.id)).slice(0,20).map(slug => [{text:'#'+slug,callback_data:'p:'+topicHandle(target.id,slug)}]);
    if (!keyboard.length) return {text:'This Assistant has no topics yet. Start one in COGNIX, or write #name and a message here.'};
    return {text:'Open a topic here. Messages you send in it go to that topic.',keyboard};
  }
  // slugs are the chosen Assistant's topics as slugs, the latest first.
  async slugs(assistant) {
    const result = await this.channel.host.request('/api/ext/v2/assistants/topics?assistant='+encodeURIComponent(assistant));
    return [...new Set((result.topics || []).map(t => topicSlug(t.name)).filter(Boolean))];
  }
  // openTopic opens a button's topic as a private-chat topic, or finds the
  // one open: the button names a topic of the Assistant chosen now by a
  // short handle (Telegram's callback_data holds 64 bytes).
  async openTopic(handle, pairGeneration) {
    if (!this.channel.topicsEnabled) throw new ApiError(409,'Topics are off for this bot.');
    await this.sync();
    const target = this.ledger.get('selected_target');
    if (!target || target.kind!=='assistant' || target.generation!==this.ledger.get('host_generation')) throw new ApiError(409,'Choose an Assistant with /assistants first.');
    await this.requireText();
    const slug = (await this.slugs(target.id)).find(s => topicHandle(target.id,s) === handle);
    if (!slug) throw new ApiError(409,'This topic is no longer available. Use /topics again.');
    const pair = this.ledger.get('pair');
    let thread = this.ledger.threadOf(target.id,slug);
    if (thread) {
      // A topic deleted in Telegram sends no update: check it is still there.
      try { await this.channel.send('sendChatAction',{chat_id:pair.chat,message_thread_id:thread,action:'typing'},pairGeneration); }
      catch (error) { if (error.status === 400) { this.ledger.forgetThread(thread); thread = 0; } else throw error; }
    }
    if (!thread) {
      const made = await this.channel.send('createForumTopic',{chat_id:pair.chat,name:slug},pairGeneration);
      thread = made?.message_thread_id;
      if (!Number.isSafeInteger(thread)) throw new ApiError(502,'The topic could not be confirmed.',{uncertain:true});
      this.ledger.setThread(thread,target.id,slug);
    }
    return {text:`Messages you send in this topic go to #${slug}.`,thread};
  }
  async replyAllowed(id, pairGeneration) {
    this.channel.assertActive(pairGeneration);
    await this.requireText();
    let result;
    try { result = await this.channel.host.request('/api/ext/v2/assistants/replies/check',{id}); } catch (error) { error.stage='host'; throw error; }
    this.channel.assertActive(pairGeneration);
    if (result.allowed !== true) throw new ApiError(403,'This Assistant reply is no longer available. Check the Channels tool and connection in COGNIX.',{code:'reply-revoked'});
  }
  validate(body, withText) {
    if (!body || !identity(body.operation) || !hex(body.session) || !hex(body.payloadHash) || withText && (typeof body.text!=='string' || !body.text.trim() || Buffer.byteLength(body.text)>16*1024 || hash(body.text)!==body.payloadHash)) throw new ApiError(400,'Invalid bounded operation.');
  }
  receipt(body) {
    this.validate(body,false);
    const row = this.ledger.operation(body.operation);
    if (row && (row.session!==body.session || row.payload_hash!==body.payloadHash)) throw new ApiError(409,'This operation changed.');
    return {operation:body.operation,payloadHash:body.payloadHash,state:row && ['sent','refused'].includes(row.state)?row.state:'uncertain'};
  }
  async send(body) {
    this.validate(body,true);
    if (!this.ledger.claimOperation(body.operation,body.session,body.payloadHash)) return this.receipt(body);
    const c = this.channel, generation = this.ledger.get('pair')?.generation;
    // Refuse instead of silently truncating a tool request. The provider limit
    // is 4096 characters; using UTF-16 units is a conservative Unicode bound.
    if (!this.enabled || body.text.length>4096 || c.sendPending || body.session!==this.session()) {
      this.ledger.finishOperation(body.operation,'refused'); return this.receipt(body);
    }
    const deadline = c.now()+18000;
    let accepted=false;
    try {
      const pair = this.ledger.get('pair');
      c.assertActive(generation);
      if (!pair || !c.bot) throw new ApiError(409,'Pair this channel first.');
      const guard = async () => {
        await this.requireText();
        c.assertActive(generation);
        if (body.session!==this.session() || c.now()>deadline) throw new ApiError(409,'The operation expired.');
      };
      const result = await c.send('sendMessage',{chat_id:pair.chat,text:body.text},generation,guard);
      if (!Number.isSafeInteger(result?.message_id)) throw new ApiError(502,'The provider receipt is incomplete.',{uncertain:true});
      accepted=true;
      this.ledger.finishOperation(body.operation,'sent',result.message_id);
    } catch (error) {
      this.ledger.finishOperation(body.operation,accepted || error.uncertain?'uncertain':'refused');
      if (error.status===429) this.ledger.set('send_retry_at',c.now()+Math.max(1,error.retryAfter)*1000);
      if (error.stage!=='host' && error.status===401) this.ledger.set('authentication_required',true);
      if (error.stage!=='host' && error.status===403 && error.code!=='text-disabled') this.ledger.set('chat_blocked',true);
    }
    return this.receipt(body);
  }
}
