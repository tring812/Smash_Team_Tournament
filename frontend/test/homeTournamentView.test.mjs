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

const { homeTournamentView } = load("../app/lib/tournamentOrder.ts");
const live = { id: "live", status: "ongoing" };
const next = { id: "next", status: "published" };
const draft = { id: "draft", status: "draft" };
const done = { id: "done", status: "completed" };

test("giải nổi bật ưu tiên giải đang diễn ra rồi đến giải sắp diễn ra", () => {
  assert.equal(homeTournamentView([live, next, done], "all").featured, live);
  assert.equal(homeTournamentView([next, done], "all").featured, next);
  assert.equal(homeTournamentView([draft, done], "all").featured, undefined);
});

test("lọc trạng thái giữ thứ tự danh sách và không đổi giải nổi bật", () => {
  const items = [live, next, done, { id: "done-2", status: "completed" }];
  assert.equal(homeTournamentView(items, "all").visible, items);
  const result = homeTournamentView(items, "completed");
  assert.deepEqual(result.visible, items.slice(2));
  assert.equal(result.featured, live);
  assert.deepEqual(homeTournamentView(items, "draft").visible, []);
});

test("không hiện lựa chọn Nháp khi danh sách không có giải nháp", () => {
  assert.equal(homeTournamentView([live, done], "all").showDraft, false);
  assert.equal(homeTournamentView([live, draft], "all").showDraft, true);
  assert.equal(homeTournamentView([live], "draft").showDraft, true);
});
