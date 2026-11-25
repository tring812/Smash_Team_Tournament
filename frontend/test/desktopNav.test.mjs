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
const { desktopNavHighlight } = load("../app/lib/desktopNav.ts");

test("nền bám mục hiện tại hoặc mục đang rê chuột trên cùng trang", () => {
  assert.equal(desktopNavHighlight("/ref", "ref", false, null, true), "ref");
  assert.equal(desktopNavHighlight("/ref", "ref", false, { pathname: "/ref", item: "schedule" }, true), "schedule");
  assert.equal(desktopNavHighlight("/login", null, false, { pathname: "/ref", item: "schedule" }, false), null);
});

test("bộ chọn giải đang mở được ưu tiên; mục trọng tài bị ẩn không giữ nền", () => {
  assert.equal(desktopNavHighlight("/ref", "ref", true, { pathname: "/ref", item: "ref" }, true), "schedule");
  assert.equal(desktopNavHighlight("/", "home", false, { pathname: "/", item: "ref" }, false), "home");
});
