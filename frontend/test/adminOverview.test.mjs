/** Thống kê admin phải phân biệt sân dự kiến với trận thực sự chiếm sân. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";
const load = createRequire(import.meta.url);
Module._extensions[".ts"] = (mod, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  mod._compile(outputText, filename);
};
const { adminOverview } = load("../app/lib/adminOverview.ts");
const match = (id, status, court = null, calledAt = null) => ({ id, status, court, calledAt });

test("không có trận: tiến độ bằng 0 và mọi sân đều trống", () => {
  const out = adminOverview([], 3);
  assert.equal(out.total, 0);
  assert.equal(out.progress, 0);
  assert.equal(out.freeCourts, 3);
  assert.deepEqual(out.onCourt, []);
});
test("không tính trận miễn đấu/huỷ; bỏ cuộc được tính là đã hoàn thành", () => {
  const out = adminOverview([match("a", "finished"), match("b", "walkover"), match("c", "scheduled"), match("d", "bye"), match("e", "cancelled")], 2);
  assert.equal(out.total, 3);
  assert.equal(out.finished, 2);
  assert.equal(out.waiting, 1);
  assert.equal(out.progress, 67);
});
test("sân dự kiến không chiếm sân; trận đã gọi và live có chiếm sân", () => {
  const out = adminOverview([match("a", "scheduled", 1), match("b", "pending", 2, "2026-12-01T01:00:00Z"), match("c", "live", 3)], 4);
  assert.equal(out.live, 1);
  assert.equal(out.called, 1);
  assert.equal(out.waiting, 1);
  assert.equal(out.freeCourts, 2);
});
test("trận kết thúc còn giờ gọi cũ không giữ sân", () => {
  const out = adminOverview([match("a", "finished", 1, "2026-12-01T01:00:00Z"), match("b", "walkover", 2, "2026-12-01T01:00:00Z")], 2);
  assert.equal(out.freeCourts, 2);
  assert.equal(out.progress, 100);
  assert.deepEqual(out.onCourt, []);
});
test("đếm mỗi sân một lần, không trừ sân null hoặc ngoài cấu hình", () => {
  const out = adminOverview([match("a", "live", 1), match("b", "live", 1), match("c", "live", null), match("d", "live", 9)], 2);
  assert.equal(out.freeCourts, 1);
  assert.equal(out.onCourt.length, 4);
});
test("trận trên sân sắp theo số sân, trận không có sân ở cuối", () => {
  const out = adminOverview([match("a", "live", 3), match("b", "live"), match("c", "scheduled", 1, "2026-12-01T01:00:00Z")], 3);
  assert.deepEqual(out.onCourt.map((m) => m.id), ["c", "a", "b"]);
});
