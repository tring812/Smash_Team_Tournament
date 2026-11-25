/** Biên bản: cột Set cộng 1 cho đội thắng từng game; game chưa xong không cộng cho ai. Không có ký hiệu G / N. */
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
const { setTally } = load('../app/lib/scoring.ts');
const rules = { pointsToWin: 21, maxPoints: 30, gamesToWin: 2 };

test('đội thắng mỗi game được +1 set, cộng dồn qua các game', () => {
  assert.deepEqual(setTally([[19, 21], [21, 15], [22, 20]], rules), [
    { winner: 'b', tally: [0, 1] },
    { winner: 'a', tally: [1, 1] },
    { winner: 'a', tally: [2, 1] },
  ]);
});

test('game thắng ở deuce (24–26) vẫn cộng set cho đội thắng', () => {
  assert.deepEqual(setTally([[24, 26]], { pointsToWin: 25, maxPoints: 30, gamesToWin: 1 }), [{ winner: 'b', tally: [0, 1] }]);
});

test('game đang đánh / không hợp lệ không cộng set cho ai', () => {
  assert.deepEqual(setTally([[21, 10], [20, 20]], rules), [{ winner: 'a', tally: [1, 0] }, null]);
  assert.deepEqual(setTally([[40, 2]], rules), [null]);
  assert.deepEqual(setTally([], rules), []);
});

test('biên bản không còn nhãn G / N cạnh tên VĐV', () => {
  const sheet = fs.readFileSync(new URL('../app/components/RallySheet.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(sheet, /"G"\s*:\s*"N"/);
  assert.doesNotMatch(sheet, /Giao đầu game|Nhận đầu game/);
  assert.match(sheet, /setTally\(/);
});
