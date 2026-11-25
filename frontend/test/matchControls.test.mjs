/** Kiểm tra cổng hai nút bằng bộ biên dịch TypeScript đã có, không thêm thư viện chạy test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import ts from 'typescript';
const load = createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  mod._compile(outputText, filename);
};
const { matchControls, completeScore } = load('../app/lib/matchControls.ts');
const rules = { pointsToWin: 21, maxPoints: 30, gamesToWin: 2 };
const match = { status: 'pending', tournamentStatus: 'published', a: { id: 'a' }, b: { id: 'b' }, court: 1, rules };
const win = [[21, 10], [21, 15]];
const controls = (patch = {}, games = [], pending = 0, busy = false, sync = 'saved') => matchControls({ ...match, ...patch }, games, pending, busy, sync);

test('trước khi bắt đầu chỉ bật nút bắt đầu, khoá ghi điểm và hoàn thành', () => {
  assert.equal(controls().canStart, true);
  assert.equal(controls().canScore, false);
  assert.equal(controls({}, win).canFinish, false);
});
test('chưa có sân hoặc thiếu đội thì không thể bắt đầu', () => {
  assert.equal(controls({ court: null }).canStart, false);
  assert.equal(controls({ b: null }).canStart, false);
});
test('trận đang đánh mở ghi điểm; đủ điểm thì chỉ mở hoàn thành', () => {
  assert.equal(controls({ status: 'live' }).canScore, true);
  assert.equal(controls({ status: 'live' }, win).canScore, false);
  assert.equal(controls({ status: 'live' }, win).canFinish, true);
});
test('điểm chưa gửi, đang gửi, mất mạng hoặc lỗi thì khoá hoàn thành', () => {
  assert.equal(controls({ status: 'live' }, win, 1).canFinish, false);
  for (const sync of ['saving', 'offline', 'error']) assert.equal(controls({ status: 'live' }, win, 0, false, sync).canFinish, false);
});
test('đang gửi thao tác bắt đầu/hoàn thành thì không cho bấm lặp hoặc cộng điểm', () => {
  assert.equal(controls({}, [], 0, true).canStart, false);
  assert.equal(controls({ status: 'live' }, [], 0, true).canScore, false);
  assert.equal(controls({ status: 'live' }, win, 0, true).canFinish, false);
});
test('đã huỷ, đã xong hoặc giải đóng thì mọi thao tác bị khoá', () => {
  for (const status of ['finished', 'walkover', 'bye', 'cancelled']) {
    const result = controls({ status }, win);
    assert.equal(result.canStart || result.canScore || result.canFinish, false);
  }
  const result = controls({ status: 'live', tournamentStatus: 'completed' }, win);
  assert.equal(result.canStart || result.canScore || result.canFinish, false);
});
test('chỉ công nhận tỉ số hợp lệ, đủ game thắng, không có game dư', () => {
  assert.equal(completeScore(win, rules), true);
  for (const games of [[], [[21, 10]], [[25, 10], [21, 0]], [[21, 0], [21, 0], [0, 0]], [[21, 0], [0, 21], [5, 0]]]) {
    assert.equal(completeScore(games, rules), false);
  }
  assert.equal(completeScore([[11, 5]], { pointsToWin: 11, maxPoints: 15, gamesToWin: 1 }), true);
});
