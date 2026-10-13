import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { applyBoost, handleHomeBoostRequest, HOME_BOOST_KEY, normalizeBoostRecord } from './home-boost-service.js';
import { readBoostTotal, recordKosxBoost, writeBoostTotal } from './src/homeShowcase.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryKv {
  constructor() { this.raw = null; }
  async get(key) { assert.equal(key, HOME_BOOST_KEY); return this.raw; }
  async put(key, value) { assert.equal(key, HOME_BOOST_KEY); this.raw = value; }
}

const visitor = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const request = (method, body) => new Request('https://feed.example.test/api/home-boost', {
  method,
  headers: body ? {'Content-Type':'application/json'} : {},
  body: body ? JSON.stringify(body) : undefined,
});

test('the shared total starts at zero and counts one visitor plus post once', async () => {
  assert.deepEqual(normalizeBoostRecord(null), {count:0, seen:[]});
  const kv = new MemoryKv();
  const env = {PUBLIC_FEED:kv};
  assert.equal((await (await handleHomeBoostRequest(request('GET'), env)).json()).count, 0);
  const first = await handleHomeBoostRequest(request('POST', {visitor, status:'2108148604447883464'}), env);
  const again = await handleHomeBoostRequest(request('POST', {visitor, status:'2108148604447883464'}), env);
  const secondVisitor = await handleHomeBoostRequest(request('POST', {visitor:other, status:'2108148604447883464'}), env);
  assert.deepEqual(await first.json(), {count:1, counted:true});
  assert.deepEqual(await again.json(), {count:1, counted:false});
  assert.deepEqual(await secondVisitor.json(), {count:2, counted:true});
  assert.equal((await (await handleHomeBoostRequest(request('GET'), env)).json()).count, 2);
  const rejected = await handleHomeBoostRequest(request('POST', {visitor, status:'not-a-post'}), env);
  assert.equal(rejected.status, 400);
  assert.equal(kv.raw.includes('2108148604447883464'), false);
});

test('a repeated local open does not ask for another total', () => {
  const bag = new Map();
  const store = {getItem:key => bag.get(key) ?? null, setItem:(key, value) => bag.set(key, value)};
  const url = 'https://x.com/example/status/2108148604447883464';
  assert.equal(readBoostTotal(store), 0);
  const first = recordKosxBoost(store, url);
  assert.equal(first.counted, true);
  assert.equal(recordKosxBoost(store, url).counted, false);
  assert.equal(recordKosxBoost(store, 'https://example.com/notes').counted, false);
  writeBoostTotal(store, 1);
  assert.equal(readBoostTotal(store), 1);
  const once = applyBoost({count:1, seen:['a'.repeat(32)]}, 'a'.repeat(32));
  assert.equal(once.counted, false);
  assert.equal(once.record.count, 1);
});
