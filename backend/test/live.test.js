'use strict';
/**
 * Kênh realtime (liveBus): gộp phạm vi thay đổi trong cửa sổ debounce — chỉ tỉ số của vài trận đổi → gửi danh sách
 * trận; có bất kỳ thay đổi cấu trúc nào → gửi "structure" để client tải lại toàn bộ.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const live = require('../src/liveBus');

const M1 = '00000000-0000-4000-8000-0000000000a1';
const M2 = '00000000-0000-4000-8000-0000000000a2';
const T = '00000000-0000-4000-8000-0000000000b1';

/** Response giả: đủ hàm subscribe dùng, gom mọi chunk đã ghi. */
function fakeStream() {
  const req = new EventEmitter();
  const res = { chunks: [], status() { return this; }, setHeader() {}, flushHeaders() {}, write(c) { this.chunks.push(c); } };
  return { req, res };
}
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const events = (res) => res.chunks.filter((c) => c.startsWith('event: changed')).map((c) => JSON.parse(c.split('data: ')[1]));

describe('liveBus.mergeScope', () => {
  test('một trận → danh sách một trận; trùng trận không lặp', () => {
    let acc = live.mergeScope(null, { kind: 'match', matchId: M1 });
    assert.deepEqual(acc, { kind: 'match', matchIds: [M1] });
    acc = live.mergeScope(acc, { kind: 'match', matchId: M1 });
    acc = live.mergeScope(acc, { kind: 'match', matchId: M2 });
    assert.deepEqual(acc, { kind: 'match', matchIds: [M1, M2] });
  });

  test('có thay đổi cấu trúc (trước hoặc sau) → structure; thiếu phạm vi coi như structure', () => {
    assert.deepEqual(live.mergeScope(live.mergeScope(null, { kind: 'match', matchId: M1 }), { kind: 'structure' }), { kind: 'structure' });
    assert.deepEqual(live.mergeScope(live.mergeScope(null, { kind: 'structure' }), { kind: 'match', matchId: M1 }), { kind: 'structure' });
    assert.deepEqual(live.mergeScope(null, undefined), { kind: 'structure' });
    assert.deepEqual(live.mergeScope(null, { kind: 'match' }), { kind: 'structure' });
  });

  test('quá nhiều trận trong một lần gộp → structure', () => {
    let acc = null;
    for (let i = 0; i < 21; i += 1) acc = live.mergeScope(acc, { kind: 'match', matchId: `m${i}` });
    assert.deepEqual(acc, { kind: 'structure' });
  });
});

describe('liveBus.subscribe', () => {
  test('gộp nhiều điểm trong 250 ms thành MỘT sự kiện mang danh sách trận', async () => {
    const { req, res } = fakeStream();
    assert.equal(live.subscribe(req, res, T), true);
    live.publish(T, { kind: 'match', matchId: M1 });
    live.publish(T, { kind: 'match', matchId: M2 });
    live.publish(T, { kind: 'match', matchId: M1 });
    await sleep(400);
    assert.deepEqual(events(res), [{ kind: 'match', matchIds: [M1, M2] }]);

    live.publish(T, { kind: 'match', matchId: M1 });
    live.publish(T); // không phạm vi = thay đổi cấu trúc
    await sleep(400);
    assert.deepEqual(events(res)[1], { kind: 'structure' });
    req.emit('close');
  });

  test('giải khác không nhận được', async () => {
    const { req, res } = fakeStream();
    live.subscribe(req, res, T);
    live.publish('00000000-0000-4000-8000-0000000000b2', { kind: 'match', matchId: M1 });
    await sleep(400);
    assert.deepEqual(events(res), []);
    req.emit('close');
  });
});
