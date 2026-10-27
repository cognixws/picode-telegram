import { ChannelV2 } from './v2.mjs';
import { diagnostic } from './problems.mjs';
import { createHash } from 'node:crypto';
import { ApiError } from './http.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
// Bound UTF-16 as well as code points; never split a surrogate pair. A
// shortened title/body announces the truncation rather than silently ending.
const clip = (text, max = 3800) => {
  text = String(text || '');
  if (text.length <= max) return text;
  const out = []; let size = 0;
  for (const char of text) { if (size + char.length > max - 1) break; out.push(char); size += char.length; }
  return out.join('') + '…';
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class Channel {
  constructor({ ledger, host, makeBot, now = Date.now, spacing = 1100 }) {
    this.ledger = ledger; this.host = host; this.makeBot = makeBot; this.now = now;
    this.bot = null; this.botName = ''; this.problem = ''; this.problemCode = ''; this.warning = ''; this.fullText = false;
    this.publicURL = ''; this.stopped = false; this.lastSend = 0; this.sendChain = Promise.resolve();
    this.protocol = 1; this.sendPending = 0; this.v2 = new ChannelV2(this);
    this.edits = new Set(); this.errors = new Map();
    this.spacing = spacing; this.lastSnapshot = 0; this.verifying = false;
  }
  status() {
    const pair = this.ledger.get('pair');
    const problem = this.problem || this.errors.values().next().value || '';
    const state = this.verifying ? 'checking' : this.connectionBlocked() || problem ? 'error' : !this.bot ? 'needs-token' : this.ledger.get('paused', false) ? 'paused' : pair ? 'connected' : 'pairing';
    const problemCode = this.ledger.get('conflict', false) ? 'poller-conflict' : this.ledger.get('authentication_required', false) ? 'token-rejected' : this.ledger.get('chat_blocked', false) ? 'chat-blocked' : this.problemCode;
    return { state, problemCode, botName: this.botName, paired: !!pair, paused: this.ledger.get('paused', false), uncertain: this.ledger.uncertain(), retryAvailable: !!this.ledger.uncertainNotice(), problem: this.ledger.get('conflict', false) ? 'Another connection is using this bot. Stop it, then check this connection.' : this.ledger.get('authentication_required', false) ? 'Disconnected: check your bot token in COGNIX.' : this.ledger.get('chat_blocked', false) ? 'Unblock this bot in Telegram, then check the connection.' : problem || this.warning, identity: pair ? { user: pair.user, chat: pair.chat } : null, restored: this.ledger.get('restored', false), publicLinkAvailable: !!this.publicURL };
  }
  connectionBlocked() { return this.verifying || !!this.problem || this.v2.blocked || ['conflict', 'authentication_required', 'chat_blocked'].some(key => this.ledger.get(key, false)); }
  async hostRead(path) {
    try { return await this.host.request(path); }
    catch (error) { error.stage = 'host'; throw error; }
  }
  async configure() {
    const me = await this.hostRead('/api/ext/v1/me');
    if (![1,2].includes(me.channelProtocol) || !me.channel || typeof me.restoreGeneration !== 'string') throw new ApiError(409, 'Update COGNIX before connecting this channel.', { code: 'host-version' });
    this.protocol = me.channelProtocol;
    this.ledger.restoreGeneration(me.restoreGeneration);
    const settings = await this.hostRead('/api/ext/v1/settings');
    this.publicURL = this.validPublicURL(me.publicUrl || '');
        this.fullText = settings.values?.full_text === true;
    const token = settings.secrets?.bot_token;
    if (!token) { this.bot = null; this.problem = ''; this.problemCode = ''; await this.v2.sync(); return; }
    const bot = this.makeBot(token);
    const identity = await bot.call('getMe');
    const webhook = await bot.call('getWebhookInfo');
    if (webhook.url) throw new ApiError(409, 'This bot has a webhook. Remove that connection or use another bot.', {code:'webhook-conflict'});
    this.ledger.bindBot(identity.id);
    this.ledger.set('authentication_required', false);
    this.bot = bot; this.botName = identity.username || '';
    // Private-chat topics (Bot API 9.3, 9.4): the bot's Threaded Mode in @BotFather.
    this.topicsEnabled = identity.has_topics_enabled === true;
    await this.v2.sync();
    const lastPoll = this.ledger.get('last_poll', 0);
    if (lastPoll && this.now() - lastPoll > 86400_000) this.warning = 'This computer was offline for over a day. Some Telegram messages may be missing.';
  }
  validPublicURL(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.username || u.password || u.search || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return '';
      return u.origin + u.pathname.replace(/\/$/, '');
    } catch { return ''; }
  }
  link(path) {
    return this.publicURL ? { text: 'Open in COGNIX', url: this.publicURL + '/#/' + path } : null;
  }
  setProblem(error) {
    const problem = diagnostic(error); this.problemCode = problem.code; this.problem = problem.message;
  }
  async check() {
    if (this.verifying) throw new ApiError(409, 'A connection check is already running.', {code:'checking'});
    this.verifying = true;
    try {
      await this.configure();
      this.ledger.set('conflict',false);
      this.ledger.set('chat_blocked',false);
      this.problem=''; this.problemCode=''; this.errors.clear();
    } catch (error) {
      this.setProblem(error);
      throw error;
    } finally { this.verifying = false; }
    return this.status();
  }
  async pairingCode() {
    if (!this.bot) throw new ApiError(409, 'Add and check your bot token in extension settings first.');
    if (this.ledger.get('pair')) throw new ApiError(409, 'Disconnect this chat before pairing another one.');
    this.problem = ''; this.ledger.set('paused', false);
    const result = this.ledger.pairingCode();
    return { ...result, botName: this.botName, url: this.botName ? `https://t.me/${encodeURIComponent(this.botName)}?start=${result.code}` : '' };
  }
  pause(paused) {
    this.ledger.set('paused', !!paused);
    if (this.v2.enabled) this.v2.blocked=true;
    const lastPoll = this.ledger.get('last_poll', 0);
    if (!paused && lastPoll && this.now() - lastPoll > 86400_000) this.warning = 'This computer was offline for over a day. Some Telegram messages may be missing.';
    return this.status();
  }
  disconnect() { if(this.v2.enabled) this.v2.blocked=true; this.ledger.unpair(); this.ledger.set('paused', true); return this.status(); }
  async retryNotice() {
    const generation = this.ledger.get('pair')?.generation;
    this.assertActive(generation);
    const row = this.ledger.uncertainNotice();
    if (!row) throw new ApiError(409, 'No uncertain notice is available.');
    let source;
    if (row.kind === 'inbox') source = await this.currentItem(row.source_id);
    else {
      const snapshot = await this.host.request('/api/ext/v1/messages');
      source = (snapshot.messages || []).find(m => m.id === row.source_id);
    }
    this.assertActive(generation);
    if (!source || row.kind === 'inbox' && source.state === 'done') throw new ApiError(409, 'This notice needs a new send from COGNIX.', {code:'history-unavailable'});
    // The owner deliberately checked Telegram; only this one outbound notice
    // is eligible again. This path never retries a core answer or owner send.
    this.ledger.settleDelivery(row.key,'retry');
    if (row.kind === 'inbox') await this.forwardInbox(source); else await this.forwardMessage(source);
    return this.status();
  }
  // One serialized send at a time also bounds a single private chat's rate.
  assertActive(generation) {
    if (generation !== this.ledger.get('pair')?.generation) throw new ApiError(409, 'This pairing changed.', { code: 'stale-pair' });
    if (this.stopped || this.ledger.get('paused', false) || this.connectionBlocked()) throw new ApiError(409, 'This channel is paused.', { code: 'paused' });
  }
  async hostWrite(path, body, generation) {
    this.assertActive(generation);
    return this.host.request(path, body);
  }
  send(method, body, generation = this.ledger.get('pair')?.generation, beforeSend) {
    this.sendPending++;
    const run = async () => {
      this.assertActive(generation);
      const delay = Math.max(0, this.lastSend + this.spacing - this.now());
      if (delay) await sleep(delay);
      this.assertActive(generation);
      const retryAt = this.ledger.get('send_retry_at', 0);
      if (retryAt > this.now()) throw new ApiError(429, 'Telegram needs more time.', { retryAfter: Math.ceil((retryAt - this.now()) / 1000) });
      if (beforeSend) await beforeSend(body);
      this.assertActive(generation);
      this.lastSend = this.now();
      return this.bot.call(method, body);
    };
    const result = this.sendChain.then(run).finally(() => { this.sendPending--; });
    this.sendChain = result.catch(() => {});
    return result;
  }
  async notice(text, extra = {}, generation = this.ledger.get('pair')?.generation, beforeSend) {
    const pair = this.ledger.get('pair');
    if (!pair) return;
    const link = this.link('');
    if (link && !extra.reply_markup) extra = {...extra, reply_markup:{inline_keyboard:[[link]]}};
    return this.send('sendMessage', { chat_id: pair.chat, text: clip(text), ...extra }, generation, beforeSend);
  }
  async updatesOnce() {
    if (!this.bot || this.ledger.get('paused', false) || this.connectionBlocked()) return;
    if (this.ledger.get('updates_retry_at', 0) > this.now()) return;
    const epoch = this.ledger.prepareUpdates();
    const updates = await this.bot.call('getUpdates', { offset: this.ledger.get('offset', 0), limit:20, timeout: 25, allowed_updates: ['message', 'callback_query'] });
    for (const update of updates) {
      if (epoch !== this.ledger.epoch() || this.stopped || this.ledger.get('paused', false)) break;
      const consumed = await this.receive(update, epoch);
      if (consumed === false) break;
    }
    this.ledger.set('last_poll', this.now());
  }
  async receive(update, epoch = this.ledger.epoch()) {
    if (this.stopped || this.ledger.get('paused', false) || this.connectionBlocked()) return false;
    if (!this.ledger.claimUpdate(update.update_id, epoch)) return;
    const finish = (state, receipt = '') => this.ledger.finishUpdate(update.update_id, state, receipt, epoch);
    const message = update.message || update.callback_query?.message;
    const user = update.callback_query?.from || message?.from;
    if (!message) { finish('ignored'); return; }
    if (!this.ledger.get('pair')) {
      const start = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]+)$/.exec(message.text || '');
      if (start && this.ledger.pair({ code: start[1], chat: message.chat, user, messageTime: message.date })) {
        finish('paired');
        await this.v2.sync();
        await this.notice('Connected to COGNIX. Use /agents to choose an agent, /assistants for Assistants with Channels enabled, or reply to an Inbox question.');
        return;
      }
      finish('ignored'); return;
    }
    if (!this.ledger.isOwner(message.chat, user)) { finish('ignored'); return; }
    const generation = this.ledger.get('pair').generation;
    if (message.date && update.message && message.date * 1000 < this.ledger.get('pair').connectedAt - 1000) { finish('ignored'); return; }
    if (update.callback_query) await this.bot.call('answerCallbackQuery', { callback_query_id: update.callback_query.id, text: 'Checking in COGNIX…' }).catch(() => {});
    // A message in a private-chat topic is answered in that topic (ADR-0376 T4b).
    const thread = topicThread(message);
    const inThread = thread ? { message_thread_id: thread } : {};
    let action;
    try {
      action = await this.route(update, message, generation);
      // Durable completion precedes its Telegram acknowledgement. Failure to
      // update a chat receipt must never repeat the core mutation.
      finish('done', action?.receipt || '');
    } catch (error) {
      if (error.code === 'paused' || error.status === 429) {
        this.ledger.releaseUpdate(update.update_id, epoch);
        if (error.status === 429) this.ledger.set('updates_retry_at', this.now() + Math.max(1, error.retryAfter) * 1000);
        return false;
      }
      finish(error.uncertain ? 'uncertain' : 'refused');
      if (error.code === 'stale-pair') return;

      const text = error.code === 'text-disabled' ? 'Turn on Include message text in Telegram settings in COGNIX.' : error.uncertain ? 'The delivery could not be confirmed. Check it in COGNIX before sending again.' : error.status === 409 ? 'This needs your attention in COGNIX, or it has already been answered.' : 'This action could not be completed. Open COGNIX and try there.';
      await this.notice(text, inThread, generation).catch(() => {});
      return;
    }
    if (action?.text) {
      const sent = await this.notice(action.text, action.keyboard ? { ...inThread, reply_markup: { inline_keyboard: action.keyboard } } : { ...(action.thread ? { message_thread_id: action.thread } : inThread) }, generation).catch(error => { this.warning = error.uncertain ? 'A chat receipt could not be confirmed. Check COGNIX before sending again.' : 'A chat receipt could not be sent. Open COGNIX to check the result.'; return null; });
      if (sent && action.keyboard) for (const row of action.keyboard) for (const button of row) if (button.callback_data) this.ledger.bindHandle(button.callback_data, sent.message_id);
      if (sent && action.receipt) {
        const kind = action.receiptKind || 'receipt';
        const key = this.key(kind, action.receipt);
        if (this.ledger.claimDelivery(key, kind, action.receipt)) this.ledger.settleDelivery(key, 'sent', sent.message_id);
      }
    }
  }
  async route(update, message, generation) {
    this.assertActive(generation);
    if (update.callback_query) {
      const data = update.callback_query.data || '';
      if (this.v2.enabled && data.startsWith('t:')) return this.v2.select(data,message.message_id,generation);
      if (this.v2.enabled && data.startsWith('p:')) return this.v2.openTopic(data.slice(2),generation);
      const button = this.ledger.resolveButton(data, message.message_id);
      if (!button) throw new ApiError(409, 'This button is no longer available.');
      if (data.startsWith('a:')) {
        if (this.v2.enabled) throw new ApiError(409,'Choose an agent again.');
        const id = button.item_id;
        const agents = await this.agents();
        const agent = agents.find(a => a.id === id);
        if (!agent) throw new ApiError(409, 'That agent is no longer running.');
        this.assertActive(generation);
        this.ledger.set('selected_agent', id);
        return { text: `Messages will go to ${agent.name}.` };
      }
      const item = await this.currentItem(button.item_id);
      const choice = item?.options?.[button.choice];
      if (!item?.answerable || typeof choice !== 'string' || digest(choice) !== button.choice_hash) throw new ApiError(409, 'This question is no longer answerable.');
      return this.answer(item.id, choice, generation);
    }
    // A topic made or renamed in the private chat: remember its name (T4b).
    // It belongs to the Assistant chosen when it was made or renamed.
    const made = message.forum_topic_created || message.forum_topic_edited;
    if (made && topicThread(message)) {
      const target = this.ledger.get('selected_target');
      const slug = typeof made.name === 'string' ? topicSlug(made.name) : '';
      if (slug && target?.kind === 'assistant') this.ledger.setThread(topicThread(message), target.id, slug);
      return null;
    }
    const text = message.text?.trim();
    if (!text) return { text: 'Only text reaches agents for now. Open COGNIX for files or audio.' };
    if (this.v2.enabled && (text === '/topics' || text.startsWith('/topics@'))) return this.v2.topics();
    if (this.v2.enabled && (text === '/assistants' || text.startsWith('/assistants@'))) return this.v2.choose('assistant');
    if (text === '/agents' || text.startsWith('/agents@')) return this.chooseAgent();
    if (text === '/help' || text === '/start') return { text: 'Use /agents for running agents or /assistants for Assistants with Channels enabled. With an Assistant chosen, /topics opens one of its topics here. Reply to a question to answer it, or reply to an agent message to continue that conversation.' };
    if (text.startsWith('/')) return { text: 'Use /agents to choose an agent, /assistants for Assistants with Channels enabled, /topics for an Assistant\'s topics, or reply to an Inbox question.' };
    // In a topic, Telegram sets reply_to_message on every message to the
    // topic's first one: that is no reply.
    const replied = topicRoot(message) ? null : message.reply_to_message;
    const mapping = replied && this.ledger.mapping(replied.message_id);
    if (replied && !mapping) return { text: 'This message is no longer linked. Use /agents to choose who to write to, or open the question in COGNIX.' };
    if (mapping?.kind === 'inbox') {
      const item = await this.currentItem(mapping.source_id);
      if (!item?.answerable) throw new ApiError(409, 'This item is not answerable here.');
      return this.answer(mapping.source_id, text, generation);
    }
    if (this.v2.enabled && ['assistant','assistant-receipt'].includes(mapping?.kind)) return this.v2.input(update,text,generation,mapping.source_id,topicThread(message));
    if (mapping && !['inbox','message','receipt'].includes(mapping.kind)) return {text:'This message has no conversation link. Use /agents or /assistants to choose who to write to.'};
    if (mapping?.kind === 'message' || mapping?.kind === 'receipt') {
      const result = await this.hostWrite('/api/ext/v1/messages/owner', { text, replyTo: mapping.source_id }, generation);
      return this.sentReceipt(result);
    }
    if (this.v2.enabled) {
      await this.v2.sync();
      const target = this.ledger.get('selected_target');
      if (target && target.generation !== this.ledger.get('host_generation')) throw new ApiError(409,'Choose a current target again.');
      if (target?.kind === 'assistant') return this.v2.input(update,text,generation,'',topicThread(message));
    }
    const to = this.v2.enabled ? this.ledger.get('selected_target')?.id : this.ledger.get('selected_agent');
    if (!to) return this.chooseAgent('Who is this for?');
    const result = await this.hostWrite('/api/ext/v1/messages/owner', { to, text }, generation);
    return this.sentReceipt(result);
  }
  sentReceipt(result) {
    const state = result.message?.state;
    const text = result.paused ? 'Your message is waiting: message delivery is paused in COGNIX.' : ['remote-terminal', 'no-signal'].includes(result.message?.reason) ? 'This agent needs you to send from COGNIX. Your message is waiting there.' : state === 'delivered' ? 'Message delivered.' : state === 'pending' ? 'Your message is waiting for the agent.' : 'The message is recorded. Check its delivery in COGNIX.';
    return { text, receipt: result.message?.id };
  }
  async answer(id, text, generation) {
    const result = await this.hostWrite('/api/ext/v1/inbox/' + encodeURIComponent(id) + '/respond', { verb: 'respond', text }, generation);
    return { text: result.toast || 'Answer recorded in COGNIX.' };
  }
  async agents() {
    const result = await this.host.request('/api/ext/v1/agents');
    return (result.agents || []).filter(a => a.running && a.id && !a.id.startsWith('assistant:'));
  }
  async chooseAgent(text = 'Choose an agent for your messages.') {
    if (this.v2.enabled) return this.v2.choose('agent',text);
    const agents = await this.agents();
    if (!agents.length) return { text: 'No agents are running. Open COGNIX to start one.' };
    const keyboard = agents.slice(0, 20).map(a => [{ text: clip(a.name, 60), callback_data: this.ledger.button(a.id, -1) }]);
    if (!keyboard.length) return { text: 'Choose your agent in COGNIX.' };
    return { text, keyboard };
  }
  async currentItem(id) {
    const snapshot = await this.host.request('/api/ext/v1/inbox');
    return (snapshot.items || []).find(item => item.id === id);
  }
  key(kind, id) { return `${this.ledger.get('pair')?.generation || 'unpaired'}:${kind}:${id}`; }
  async unavailableInbox(id) {
    const pair = this.ledger.get('pair');
    if (!pair) return;
    const key = this.key('inbox', id), row = this.ledger.delivery(key);
    if (!row || row.state !== 'sent' || row.revision === 'unavailable' || this.edits.has(key)) return;
    this.edits.add(key);
    const link = this.link('inbox');
    try {
      await this.send('editMessageText', {chat_id:pair.chat,message_id:row.telegram_id,
        text:'This item is no longer available in COGNIX. Open your Inbox to check it.',
        reply_markup:{inline_keyboard:link?[[link]]:[]}}, pair.generation);
      this.ledger.settleDelivery(key,'sent',row.telegram_id,0,'unavailable');
    } catch { this.warning = 'A Telegram notice could not be updated. Open COGNIX to check the current question.'; }
    finally { this.edits.delete(key); }
  }
  async forwardInbox(item) {
    if (!item.id) return;
    if (item.deleted) { await this.unavailableInbox(item.id); return; }
    if (item.snoozedUntil && Date.parse(item.snoozedUntil) > this.now()) return;
    const pair = this.ledger.get('pair');
    if (!pair) return;
    const key = this.key('inbox', item.id);
    const row = this.ledger.delivery(key);
    const title = clip(item.title, 200);
    if (this.v2.enabled) await this.v2.textEnabled();
    const makeText = () => clip(`${title}${this.fullText && item.body ? '\n\n' + item.body : ''}${item.state === 'done' ? '\n\nAnswered in COGNIX.' : item.answerable ? '\n\nReply to answer.' : '\n\nOpen COGNIX to act on this.'}`);
    const text = makeText();
    let revision = digest(text + JSON.stringify(item.options || []));
    const refresh = async body => {
      if (this.v2.enabled) await this.v2.textEnabled();
      body.text=makeText(); revision=digest(body.text+JSON.stringify(item.options||[]));
    };
    if (row?.state === 'sent' && (row.revision === revision || this.edits.has(key))) return;
    if (row && row.state !== 'sent' && (row.state !== 'retry' || row.retry_at > this.now())) return;
    const keyboard = [];
    if (item.state !== 'done' && item.answerable && Array.isArray(item.options)) {
      for (const [index, option] of item.options.slice(0, 6).entries()) keyboard.push([{ text: clip(option, 80), callback_data: this.ledger.button(item.id, index, option) }]);
    }
    const link = this.link(item.blockedReason ? 'inbox' : 'inbox/' + encodeURIComponent(item.id));
    if (link) keyboard.push([link]);
    if (row?.state === 'sent') {
      this.edits.add(key);
      try {
        await this.send('editMessageText', { chat_id: pair.chat, message_id: row.telegram_id, text, reply_markup: { inline_keyboard: keyboard } },pair.generation,refresh);
        for (const buttons of keyboard) for (const button of buttons) if (button.callback_data) this.ledger.bindHandle(button.callback_data, row.telegram_id);
        this.ledger.settleDelivery(key, 'sent', row.telegram_id, 0, revision);
      } catch { this.warning = 'A Telegram receipt could not be updated. The answer remains recorded in COGNIX.'; }
      finally { this.edits.delete(key); }
      return;
    }
    if (item.state === 'done' || !this.ledger.claimDelivery(key, 'inbox', item.id)) return;
    try {
      const message = await this.send('sendMessage', { chat_id: pair.chat, text, reply_markup: { inline_keyboard: keyboard } },pair.generation,refresh);
      for (const buttons of keyboard) for (const button of buttons) if (button.callback_data) this.ledger.bindHandle(button.callback_data, message.message_id);
      this.ledger.settleDelivery(key, 'sent', message.message_id, 0, revision);
    } catch (error) { this.failedSend(key, error); }
  }
  failedSend(key, error) {
    if (['text-disabled','reply-revoked'].includes(error.code) || error.stage==='host') {
      const transient = error.stage==='host' && (!error.status || error.status===429 || error.status>=500);
      this.ledger.settleDelivery(key, transient?'retry':'failed',null,transient?this.now()+Math.max(5,error.retryAfter||0)*1000:0);
      this.warning = error.code==='text-disabled' ? 'Assistant replies require Include message text in Telegram settings.' : 'The reply was not sent. Check the Assistant Channels tool and the connection in COGNIX.';
      return;
    }
    if (error.code === 'paused') { this.ledger.settleDelivery(key, 'retry'); return; }
    if (error.code === 'stale-pair') { this.ledger.settleDelivery(key, 'historical'); return; }
    if (error.status === 429) {
      const retryAt = this.now() + Math.max(1, error.retryAfter) * 1000;
      this.ledger.settleDelivery(key, 'retry', null, retryAt);
      this.ledger.set('send_retry_at', retryAt);
    }
    else this.ledger.settleDelivery(key, error.uncertain ? 'uncertain' : [401, 403].includes(error.status) ? 'retry' : 'failed');
    if (error.status === 401) { this.ledger.set('authentication_required',true); this.errors.set('telegram','Disconnected: check your bot token in COGNIX.'); }
    if (error.status === 403) this.ledger.set('chat_blocked', true);
    this.warning = error.uncertain ? 'A delivery could not be confirmed. Check Telegram before retrying in COGNIX.' : error.status === 401 ? 'Disconnected: the bot token is no longer valid.' : error.status === 409 ? 'Another connection is using this bot.' : 'Telegram could not receive a message. Open COGNIX to check it.';
  }
  async forwardMessage(message) {
    if (message.to !== 'owner' || !message.from || typeof message.from === 'string') return;
    const assistant = message.from.kind === 'assistant';
    const kind = assistant ? 'assistant' : 'message';
    const key = this.key(kind, message.id), generation = this.ledger.get('pair')?.generation;
    if (!this.ledger.claimDelivery(key, kind, message.id)) return;
    const pair = this.ledger.get('pair');
    const link = this.link('messages');
    const thread = assistant && message.replyTo ? this.ledger.inputThread(message.replyTo) : 0;
    const body = {chat_id:pair?.chat,text:'',...(thread?{message_thread_id:thread}:{}),...(link?{reply_markup:{inline_keyboard:[[link]]}}:{})};
    try {
      const result = await this.send('sendMessage',body,generation,async () => {
        if (this.v2.enabled) {
          if (assistant) await this.v2.replyAllowed(message.id,generation);
          else await this.v2.textEnabled();
        } else if (assistant) throw new ApiError(403,'Assistant entry requires V2.');
        body.text = clip(`${message.from.name || 'Agent'} sent a message.${this.fullText ? '\n\n' + message.body : '\n\nOpen COGNIX to read it. You can reply here.'}`);
      });
      this.ledger.settleDelivery(key, 'sent', result.message_id);
    } catch (error) { this.failedSend(key, error); }
    // A claimed response (including unknown outcome) is never replayed through
    // a startup snapshot; known-refused V1 notice retries have their own ledger.
    if (assistant && message.replyTo) this.ledger.completeInput(message.replyTo);
  }
  async inboxOnce({ wait = 0, snapshot = false } = {}) {
    if (!this.bot || !this.ledger.get('pair') || this.ledger.get('paused', false) || this.connectionBlocked()) return;
    const generation = this.ledger.get('pair').generation;
    const cursor = this.ledger.get('inbox_cursor');
    const result = await this.host.request('/api/ext/v1/inbox' + (!snapshot && cursor !== null ? `?since=${cursor}&wait=${wait}` : ''));
    this.assertActive(generation);
    for (const item of result.items || []) { this.assertActive(generation); await this.forwardInbox(item); }
    if ((snapshot || result.reset || cursor === null) && !result.truncated) {
      const present = new Set((result.items || []).map(item => item.id));
      // A complete open snapshot can prove absence, without retaining text
      // or falsely calling a deleted/closed item an answered question.
      for (const row of this.ledger.sentInbox().filter(row => !present.has(row.source_id)).slice(0,20)) {
        this.assertActive(generation); await this.unavailableInbox(row.source_id);
      }
    }
    if (result.reset || snapshot) this.warning ||= result.reset ? 'The Inbox history changed. Current questions were checked again.' : '';
    this.ledger.set('inbox_cursor', result.cursor);
  }
  async messagesOnce({ wait = 0 } = {}) {
    if (!this.bot || !this.ledger.get('pair') || this.ledger.get('paused', false) || this.connectionBlocked()) return;
    const generation = this.ledger.get('pair').generation;
    const cursor = this.ledger.get('messages_cursor');
    const result = await this.host.request('/api/ext/v1/messages' + (cursor !== null ? `?since=${cursor}&wait=${wait}` : ''));
    this.assertActive(generation);
    // Initial and reset snapshots are context, not unsent messages.
    const pending = new Set(this.ledger.pendingInputs());
    for (const message of (result.messages || []).filter(message => cursor !== null && !result.reset || message.from?.kind==='assistant' && pending.has(message.replyTo))) { this.assertActive(generation); await this.forwardMessage(message); }
    if (result.reset) this.warning = 'Some message history is no longer available. Open COGNIX to check the conversation.';
    this.ledger.set('messages_cursor', result.cursor);
  }
  async retryOnce() {
    if (!this.bot || !this.ledger.get('pair') || this.ledger.get('paused', false) || this.connectionBlocked()) return;
    const generation = this.ledger.get('pair').generation;
    const rows = this.ledger.dueDeliveries();
    if (!rows.length) return;
    const snapshots = new Map();
    for (const kind of new Set(rows.map(row => row.kind))) {
      const result = await this.host.request('/api/ext/v1/' + (kind === 'inbox' ? 'inbox' : 'messages'));
      snapshots.set(kind, kind === 'inbox' ? result.items || [] : result.messages || []);
    }
    this.assertActive(generation);
    for (const row of rows) {
      this.assertActive(generation);
      const source = snapshots.get(row.kind).find(item => item.id === row.source_id);
      if (!source || row.kind === 'inbox' && source.state === 'done') {
        this.ledger.settleDelivery(row.key, 'failed');
        this.warning = 'A delayed notice is outside the available history. Open COGNIX to check it.';
        continue;
      }
      if (row.kind === 'inbox') await this.forwardInbox(source); else await this.forwardMessage(source);
    }
  }
  async reconcileOnce() {
    await this.v2.sync();
    await this.retryOnce();
    if (this.v2.enabled && this.ledger.pendingInputs().length) {
      const pending = new Set(this.ledger.pendingInputs());
      const generation = this.ledger.get('pair')?.generation;
      const result = await this.host.request('/api/ext/v1/messages');
      this.assertActive(generation);
      for (const message of result.messages || []) if (message.from?.kind==='assistant' && pending.has(message.replyTo)) await this.forwardMessage(message);
    }
    if (this.now() - this.lastSnapshot >= 60_000) {
      await this.inboxOnce({ snapshot: true });
      this.ledger.prune(); this.lastSnapshot = this.now();
    }
  }
  async loop(fn, source = 'host') {
    while (!this.stopped) {
      try { await fn(); this.errors.delete(source); }
      catch (error) { if (['paused', 'stale-pair'].includes(error.code)) continue; if (source === 'telegram' && error.status === 409) this.ledger.set('conflict', true); if (source === 'telegram' && error.status === 401) this.ledger.set('authentication_required',true); this.errors.set(source, error.code === 'ledger-full' ? error.message : error.status === 401 ? 'Disconnected: check your bot token in COGNIX.' : error.status === 409 ? 'Another connection is using this bot.' : 'The connection was interrupted. Check COGNIX or try again.'); }
      if (!this.stopped) await sleep(this.bot ? 1000 : 3000);
    }
  }
  start() {
    this.loops = [this.loop(() => this.updatesOnce(), 'telegram'), this.loop(() => this.inboxOnce({ wait: 25 }), 'inbox'), this.loop(() => this.messagesOnce({ wait: 25 }), 'messages'), this.loop(async () => {
      await sleep(10_000);
      if (!this.stopped) await this.reconcileOnce();
    }, 'reconcile')];
  }
  stop() { this.stopped = true; }
}

// topicThread is the private-chat topic a message is in (Bot API 9.3), or 0.
export function topicThread(message) {
  return message?.is_topic_message && Number.isSafeInteger(message.message_thread_id) ? message.message_thread_id : 0;
}

// topicRoot says a message's reply_to_message is only its topic's first
// message, as Telegram sets it on every message of a topic.
export function topicRoot(message) {
  const r = message?.reply_to_message;
  return !!(topicThread(message) && r && (r.message_id === message.message_thread_id || r.forum_topic_created));
}

// Names the core reserves: "#all" stays text there, so it is never a mark.
const RESERVED = new Set(['all']);
const MAX = 32;

// topicSlug writes a Telegram topic's name as the core keeps a topic's name
// (internal/store CleanTopicName): letters and decimal digits, lower case; a
// mark or a joiner only after a letter; one hyphen between words; at most 32
// characters. What the core would refuse is dropped as a word break here, so
// a name always gives the slug the core would keep. "" when nothing is left
// or the name is reserved.
export function topicSlug(name) {
  let out = '', dash = false, afterLetter = false;
  for (const ch of String(name || '').normalize('NFKC')) {
    if (/\p{L}|\p{Nd}/u.test(ch)) { out += ch.toLowerCase(); dash = false; afterLetter = true; }
    else if (/\p{M}/u.test(ch) || ch === '\u200c' || ch === '\u200d') { if (afterLetter) { out += ch; dash = false; } }
    else { if (!dash && out) out += '-'; dash = true; afterLetter = false; }
  }
  let chars = [...out.normalize('NFC').replace(/^-+|-+$/g, '')];
  if (chars.length > MAX) chars = chars.slice(0, MAX);
  const slug = chars.join('').replace(/-+$/, '');
  return RESERVED.has(slug) ? '' : slug;
}
