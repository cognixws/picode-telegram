import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Ledger } from '../server/ledger.mjs';

function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'picode-telegram-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'data.db');
  const database = new DatabaseSync(path);
  database.exec(readFileSync(new URL('../migrations/001_ledger.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../migrations/002_channels_v2.sql', import.meta.url), 'utf8'));
  database.close();
  let now = 1_800_000_000_000;
  const ledger = new Ledger(path, { now: () => now });
  t.after(() => ledger.close());
  ledger.bindBot(91);
  const owner = { id: 14, is_bot: false };
  const chat = { id: 14, type: 'private' };
  return { ledger, path, owner, chat, advance: n => { now += n; }, pair: code => ledger.pair({ code, chat, user: owner, messageTime: now / 1000 }) };
}

test('pairing binds one private account with a one-use ten-minute code', t => {
  const f = fixture(t), { code } = f.ledger.pairingCode();
  assert.equal(f.ledger.pair({ code, chat: { ...f.chat, type: 'group' }, user: f.owner, messageTime: 1_800_000_000 }), false);
  assert.equal(f.pair('wrong'), false);
  assert.equal(f.pair(code), true);
  assert.equal(f.pair(code), false);
  assert.equal(f.ledger.isOwner(f.chat, f.owner), true);
  assert.equal(f.ledger.isOwner(f.chat, { id: 19 }), false);
  assert.equal(f.ledger.isOwner({ ...f.chat, type: 'group' }, f.owner), false);
  assert.equal(f.ledger.isOwner(f.chat, { ...f.owner, is_bot: true }), false);
  assert.equal(readFileSync(f.path).includes(Buffer.from(code)), false);
});

test('expired and predating pairing messages do not authorize a chat', t => {
  const f = fixture(t), { code } = f.ledger.pairingCode();
  assert.equal(f.ledger.pair({ code, chat: f.chat, user: f.owner, messageTime: 1_799_999_990 }), false);
  assert.equal(f.ledger.pair({ code, chat: f.chat, user: f.owner }), false);
  f.advance(600_000);
  assert.equal(f.pair(code), false);
});

test('another bot or a restored host generation clears pairing and old handles', t => {
  const f = fixture(t);
  assert.equal(f.pair(f.ledger.pairingCode().code), true);
  f.ledger.claimDelivery('old', 'inbox', 'item');
  f.ledger.settleDelivery('old', 'sent', 18);
  const handle = f.ledger.button('item', 0);
  f.ledger.bindButtons('item', 18);
  assert.equal(f.ledger.restoreGeneration('snapshot:completed'), true);
  assert.equal(f.ledger.get('pair'), null);
  assert.equal(f.ledger.resolveButton(handle, 18), undefined);
  assert.equal(f.ledger.mapping(18), undefined);
  assert.equal(f.ledger.restoreGeneration('snapshot:completed'), false);
  assert.equal(f.pair(f.ledger.pairingCode().code), true);
  f.ledger.bindBot(92);
  assert.equal(f.ledger.get('pair'), null);
});

test('an incoming update claims once and advances a durable replay floor', t => {
  const f = fixture(t);
  assert.equal(f.ledger.claimUpdate(75), true);
  assert.equal(f.ledger.claimUpdate(75), false);
  f.ledger.finishUpdate(75, 'done', 'message-receipt');
  assert.equal(f.ledger.claimUpdate(74), false);
  assert.equal(f.ledger.get('offset'), 76);
});

test('crashed sends stay uncertain instead of becoming automatic retries', t => {
  const f = fixture(t);
  assert.equal(f.ledger.claimDelivery('question', 'inbox', 'item'), true);
  assert.equal(f.ledger.claimUpdate(13), true);
  const reopened = new Ledger(f.path);
  t.after(() => reopened.close());
  assert.equal(reopened.delivery('question').state, 'uncertain');
  assert.equal(reopened.claimDelivery('question', 'inbox', 'item'), false);
  assert.equal(reopened.claimUpdate(13), false);
  assert.equal(reopened.db.prepare('SELECT state FROM updates WHERE id=13').get().state, 'uncertain');
});

test('known rate-limit refusal waits until the retry deadline', t => {
  const f = fixture(t);
  f.ledger.claimDelivery('question', 'inbox', 'item');
  f.ledger.settleDelivery('question', 'retry', null, 1_800_000_002_000);
  assert.equal(f.ledger.claimDelivery('question', 'inbox', 'item'), false);
  f.advance(2000);
  assert.equal(f.ledger.claimDelivery('question', 'inbox', 'item'), true);
});

test('a week without input permits a randomized lower update ID in a new epoch', t => {
 const f = fixture(t);
 f.ledger.prepareUpdates();
 assert.equal(f.ledger.claimUpdate(100000),true);
 f.ledger.finishUpdate(100000,'done');
 const old = f.ledger.epoch();
 f.advance(7 * 86400_000);
 const fresh = f.ledger.prepareUpdates();
 assert.notEqual(fresh,old);
 assert.equal(f.ledger.get('offset'),0);
 assert.equal(f.ledger.claimUpdate(12),true);
 f.ledger.finishUpdate(100001,'done','old',old);
 assert.equal(f.ledger.get('offset'),0);
 f.ledger.finishUpdate(12,'done');
 assert.equal(f.ledger.get('offset'),13);
});

test('pausing before actuation can release an update without acknowledging it', t => {
 const f = fixture(t);
 assert.equal(f.ledger.claimUpdate(1),true);
 f.ledger.releaseUpdate(1);
 assert.equal(f.ledger.get('offset',0),0);
 assert.equal(f.ledger.claimUpdate(1),true);
});
