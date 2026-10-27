import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { ApiError } from './http.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

// The database contains identities, cursors and receipts, and the names of
// the private chat's topics (labels the owner chose), never the bot token or
// message content. PiCode applies migrations before starting the process.
export class Ledger {
  constructor(path, { now = Date.now } = {}) {
    this.db = new DatabaseSync(path);
    this.now = now;
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.prepare("UPDATE operations SET state='uncertain' WHERE state='dispatching'").run();
    this.db.prepare("UPDATE deliveries SET state='uncertain' WHERE state='dispatching'").run();
    this.db.prepare("UPDATE updates SET state='uncertain' WHERE state='claimed'").run();
  }
  close() { this.db.close(); }
  get(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  set(key, value) {
    this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  restoreGeneration(generation) {
    return this.transaction(() => {
      const previous = this.get('restore_generation', '');
      if (generation === previous) return false;
      this.clearPair();
      this.set('restore_generation', generation);
      this.set('restored', true);
      return true;
    });
  }
  bindBot(id) {
    id = String(id);
    this.transaction(() => {
      const previous = this.get('bot_id');
      if (previous && previous !== id) { this.clearPair(); this.set('conflict',false); }
      this.set('bot_id', id);
    });
  }
  clearPair() {
    for (const key of ['pair', 'pair_code', 'selected_agent', 'selected_target', 'host_generation', 'inbox_cursor', 'messages_cursor']) this.db.prepare('DELETE FROM metadata WHERE key=?').run(key);
    this.db.prepare('DELETE FROM buttons').run();
    this.db.prepare('DELETE FROM targets').run();
    // Another chat's topics are not this one's.
    this.db.prepare('DELETE FROM threads').run();
    this.db.prepare('DELETE FROM input_threads').run();
    this.set('chat_blocked', false);
    this.newUpdateEpoch();
    // A restored or disconnected receipt is evidence, never queued work.
    this.db.prepare("UPDATE deliveries SET state='historical'").run();
    this.db.prepare("DELETE FROM deliveries WHERE state='historical' AND key NOT IN (SELECT key FROM deliveries ORDER BY changed_at DESC LIMIT 2000)").run();
  }
  unpair() { this.transaction(() => this.clearPair()); }
  pairingCode() {
    const code = randomBytes(12).toString('base64url');
    this.set('pair_code', { hash: hash(code), issued: this.now(), expires: this.now() + 600_000 });
    return { code, expires: this.get('pair_code').expires };
  }
  pair({ code, chat, user, messageTime }) {
    if (chat?.type !== 'private' || !Number.isSafeInteger(chat.id) || !Number.isSafeInteger(user?.id) || user.is_bot || !Number.isSafeInteger(messageTime)) return false;
    return this.transaction(() => {
      const expected = this.get('pair_code');
      if (!expected || this.get('pair') || expected.expires <= this.now() || Number(messageTime) * 1000 < expected.issued - 1000) return false;
      const supplied = hash(String(code));
      if (!timingSafeEqual(Buffer.from(expected.hash), Buffer.from(supplied))) return false;
      this.set('pair', { chat: chat.id, user: user.id, bot: this.get('bot_id'), connectedAt: this.now(), generation: randomBytes(9).toString('base64url') });
      this.db.prepare("DELETE FROM metadata WHERE key='pair_code'").run();
      this.set('restored', false);
      return true;
    });
  }
  isOwner(chat, user) {
    const pair = this.get('pair');
    return !!pair && chat?.type === 'private' && chat.id === pair.chat && user?.id === pair.user && !user.is_bot && pair.bot === this.get('bot_id');
  }
  epoch() { return this.get('update_epoch', 1); }
  newUpdateEpoch() {
    this.set('update_epoch', this.epoch() + 1);
    this.set('offset', 0);
    this.set('last_update_received', this.now());
  }
  prepareUpdates() {
    const last = this.get('last_update_received', 0);
    // Telegram can randomize the next ID after a week without updates.
    // Six days exceeds its 24-hour retention but precedes that reset.
    if (last && this.now() - last > 6 * 86400_000) this.newUpdateEpoch();
    if (!last) this.set('last_update_received', this.now());
    return this.epoch();
  }
  claimUpdate(id, epoch = this.epoch()) {
    if (epoch !== this.epoch() || !Number.isSafeInteger(id) || id < this.get('offset', 0)) return false;
    const result = this.db.prepare("INSERT OR IGNORE INTO updates(epoch,id,state,received_at) VALUES(?,?,'claimed',?)").run(epoch, id, this.now());
    if (result.changes === 1) this.set('last_update_received', this.now());
    if (!result.changes) this.set('offset', Math.max(this.get('offset', 0), id + 1));
    return result.changes === 1;
  }
  releaseUpdate(id, epoch = this.epoch()) {
    this.db.prepare("DELETE FROM updates WHERE epoch=? AND id=? AND state='claimed'").run(epoch, id);
  }
  finishUpdate(id, state, receipt = '', epoch = this.epoch()) {
    this.transaction(() => {
      this.db.prepare('UPDATE updates SET state=?,receipt=? WHERE epoch=? AND id=?').run(state, receipt, epoch, id);
      if (epoch === this.epoch()) this.set('offset', Math.max(this.get('offset', 0), id + 1));
    });
  }
  // Private-chat topics (ADR-0376 T4b): a thread's slug, the thread of a
  // slug, and the thread an input came from.
  thread(id) { return Number.isSafeInteger(id) ? this.db.prepare('SELECT slug FROM threads WHERE thread_id=?').get(id)?.slug || '' : ''; }
  threadOf(slug) { return slug ? this.db.prepare('SELECT thread_id FROM threads WHERE slug=? ORDER BY created_at DESC LIMIT 1').get(slug)?.thread_id || 0 : 0; }
  setThread(id, slug) {
    if (!Number.isSafeInteger(id) || !slug) return;
    this.db.prepare('INSERT INTO threads(thread_id,slug,created_at) VALUES(?,?,?) ON CONFLICT(thread_id) DO UPDATE SET slug=excluded.slug').run(id, slug, this.now());
  }
  bindInputThread(messageID, thread) {
    if (!messageID || !Number.isSafeInteger(thread)) return;
    this.db.prepare('INSERT OR IGNORE INTO input_threads(message_id,thread_id,created_at) VALUES(?,?,?)').run(messageID, thread, this.now());
    this.db.prepare('DELETE FROM input_threads WHERE message_id NOT IN (SELECT message_id FROM input_threads ORDER BY created_at DESC LIMIT 2000)').run();
  }
  inputThread(messageID) { return messageID ? this.db.prepare('SELECT thread_id FROM input_threads WHERE message_id=?').get(messageID)?.thread_id || 0 : 0; }
  delivery(key) { return this.db.prepare('SELECT * FROM deliveries WHERE key=?').get(key); }
  claimDelivery(key, kind, sourceID) {
    const row = this.delivery(key);
    if (row && (row.state !== 'retry' || row.retry_at > this.now())) return false;
    if (!row && this.db.prepare('SELECT count(*) n FROM deliveries').get().n >= 10000) throw new ApiError(409, 'Delivery history is full. Disconnect and reconnect to archive it.', { code: 'ledger-full' });
    this.db.prepare("INSERT INTO deliveries(key,kind,source_id,state,changed_at) VALUES(?,?,?,'dispatching',?) ON CONFLICT(key) DO UPDATE SET state='dispatching',changed_at=excluded.changed_at").run(key, kind, sourceID, this.now());
    return true;
  }
  settleDelivery(key, state, telegramID = null, retryAt = 0, revision = '') {
    this.db.prepare("UPDATE deliveries SET state=?,telegram_id=coalesce(?,telegram_id),retry_at=?,changed_at=?,revision=? WHERE key=? AND state<>'historical'").run(state, telegramID, retryAt, this.now(), revision, key);
  }
  mapping(telegramID) {
    return this.db.prepare("SELECT * FROM deliveries WHERE telegram_id=? AND state='sent' ORDER BY changed_at DESC LIMIT 1").get(telegramID);
  }
  button(itemID, choice, value = '') {
    const handle = (choice === -1 ? 'a:' : 'q:') + randomBytes(9).toString('base64url');
    this.db.prepare('DELETE FROM buttons WHERE created_at<?').run(this.now()-7*86400_000);
    if (this.db.prepare('SELECT count(*) n FROM buttons').get().n >= 10000) throw new ApiError(409, 'Delivery history is full. Disconnect and reconnect to archive it.', { code: 'ledger-full' });
    this.db.prepare('INSERT INTO buttons(handle,item_id,choice,choice_hash,created_at) VALUES(?,?,?,?,?)').run(handle, itemID, choice, hash(value), this.now());
    return handle;
  }
  bindButtons(itemID, telegramID) { this.db.prepare('UPDATE buttons SET telegram_id=? WHERE item_id=?').run(telegramID, itemID); }
  bindHandle(handle, telegramID) {
    this.db.prepare('UPDATE buttons SET telegram_id=? WHERE handle=?').run(telegramID, handle);
    this.db.prepare('UPDATE targets SET telegram_id=? WHERE handle=?').run(telegramID, handle);
  }
  resolveButton(handle, telegramID) {
    return this.db.prepare('SELECT * FROM buttons WHERE handle=? AND telegram_id=?').get(handle, telegramID);
  }
  uncertainNotice() {
    const prefix = (this.get('pair')?.generation || 'unpaired') + ':';
    return this.db.prepare("SELECT * FROM deliveries WHERE state='uncertain' AND kind IN ('inbox','message','assistant') AND substr(key,1,?)=? ORDER BY changed_at LIMIT 1").get(prefix.length,prefix);
  }
  dueDeliveries(limit = 50) {
    const prefix = (this.get('pair')?.generation || 'unpaired') + ':';
    return this.db.prepare("SELECT * FROM deliveries WHERE state='retry' AND kind IN ('inbox','message','assistant') AND retry_at<=? AND substr(key,1,?)=? ORDER BY retry_at,changed_at LIMIT ?").all(this.now(), prefix.length, prefix, limit);
  }
  sentInbox() {
    const prefix = (this.get('pair')?.generation || 'unpaired') + ':';
    return this.db.prepare("SELECT * FROM deliveries WHERE state='sent' AND kind='inbox' AND revision<>'unavailable' AND substr(key,1,?)=? ORDER BY changed_at LIMIT 10000").all(prefix.length, prefix);
  }
  uncertain() { return this.db.prepare("SELECT count(*) n FROM operations WHERE state='uncertain'").get().n + this.db.prepare("SELECT count(*) n FROM deliveries WHERE state='uncertain'").get().n + this.db.prepare("SELECT count(*) n FROM updates WHERE epoch=? AND state='uncertain'").get(this.epoch()).n; }
  operation(id) { return this.db.prepare('SELECT * FROM operations WHERE id=?').get(id); }
  claimOperation(id, session, payloadHash) {
    return this.transaction(() => {
      const row = this.operation(id);
      if (row) {
        if (row.session !== session || row.payload_hash !== payloadHash) throw new ApiError(409, 'This operation changed.');
        return false;
      }
      if (this.db.prepare('SELECT count(*) n FROM operations').get().n >= 10000) throw new ApiError(409, 'Operation history is full.', { code:'ledger-full' });
      this.db.prepare("INSERT INTO operations(id,session,payload_hash,state,changed_at) VALUES(?,?,?,'dispatching',?)").run(id, session, payloadHash, this.now());
      return true;
    });
  }
  finishOperation(id, state, telegramID = null) {
    this.db.prepare("UPDATE operations SET state=?,telegram_id=?,changed_at=? WHERE id=? AND state='dispatching'").run(state, telegramID, this.now(), id);
  }
  newPicker() {
    const next = this.get('picker_revision', 0) + 1;
    this.set('picker_revision', next);
    this.db.prepare('DELETE FROM targets').run();
    return next;
  }
  targetButton(target, picker) {
    const handle = 't:' + randomBytes(12).toString('base64url');
    this.db.prepare('INSERT INTO targets(handle,kind,id,generation,revision,picker,created_at) VALUES(?,?,?,?,?,?,?)').run(handle, target.kind, target.id, target.generation, target.revision, picker, this.now());
    return handle;
  }
  resolveTarget(handle, telegramID, generation) {
    const row = this.db.prepare('SELECT * FROM targets WHERE handle=? AND telegram_id=? AND generation=? AND picker=? AND created_at>?').get(handle, telegramID, generation, this.get('picker_revision',0), this.now()-600000);
    return row && {kind:row.kind,id:row.id,generation:row.generation,revision:row.revision};
  }
  selectTarget(target) {
    this.transaction(() => { this.newPicker(); this.set('selected_target', target); this.db.prepare("DELETE FROM metadata WHERE key='selected_agent'").run(); });
  }
  bindInput(key, id) {
    this.db.prepare("UPDATE deliveries SET source_id=?,state='awaiting',changed_at=? WHERE key=? AND state='dispatching'").run(id,this.now(),key);
  }
  completeInput(id) {
    const prefix = (this.get('pair')?.generation || 'unpaired') + ':input:';
    this.db.prepare("UPDATE deliveries SET state='done',changed_at=? WHERE kind='input' AND source_id=? AND state='awaiting' AND substr(key,1,?)=?").run(this.now(),id,prefix.length,prefix);
  }
  pendingInputs() {
    const prefix = (this.get('pair')?.generation || 'unpaired') + ':input:';
    return this.db.prepare("SELECT source_id FROM deliveries WHERE state='awaiting' AND substr(key,1,?)=? LIMIT 10000").all(prefix.length,prefix).map(row => row.source_id);
  }
  prune() {
    this.db.prepare('DELETE FROM updates WHERE (epoch,id) NOT IN (SELECT epoch,id FROM updates ORDER BY received_at DESC,epoch DESC,id DESC LIMIT 10000)').run();
    this.db.prepare("DELETE FROM deliveries WHERE state = 'historical' AND changed_at<? AND key NOT IN (SELECT key FROM deliveries ORDER BY changed_at DESC LIMIT 2000)").run(this.now() - 7 * 86400_000);
    this.db.prepare('DELETE FROM buttons WHERE created_at<?').run(this.now() - 7 * 86400_000);
  }
}
