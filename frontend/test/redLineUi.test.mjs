/** Kiểm tra nhận diện và các thuộc tính truy cập của thành phần Red Line. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const load = createRequire(import.meta.url);
Module._extensions[".tsx"] = (mod, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  mod._compile(outputText, filename);
};
const { RedLineBrand, StartingCourt } = load("../app/components/RedLineBrand.tsx");
const { Button, PageHeader, Card, Notice } = load("../app/components/ui.tsx");
const render = (component, props) => renderToStaticMarkup(createElement(component, props));

test("nhận diện có tên Red Line và ngữ cảnh cầu lông", () => {
  const html = render(RedLineBrand);
  assert.match(html, /Red /);
  assert.match(html, /Line/);
  assert.match(html, /Smash Team · Cầu lông/);
  assert.match(html, /aria-hidden="true"/);
});
test("minh hoạ là véc-tơ trang trí, không gọi ảnh từ xa", () => {
  const html = render(StartingCourt);
  assert.match(html, /<svg/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /<image|<img|https?:/);
});
test("nút mới vẫn khoá khi bận và không tự gửi biểu mẫu", () => {
  const html = render(Button, { loading: true, children: "Xác nhận kết quả" });
  assert.match(html, /type="button"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /Đang xử lý/);
  assert.match(html, /min-h-11/);
});
test("tiêu đề, thẻ và thông báo vẫn có cấu trúc ngữ nghĩa", () => {
  assert.match(render(PageHeader, { title: "Bàn trọng tài", eyebrow: "Trọng tài" }), /<h1[^>]*>Bàn trọng tài<\/h1>/);
  assert.match(render(Card, { title: "Tổng quan", children: "Lịch đấu" }), /<section/);
  assert.match(render(Notice, { kind: "error", children: "Sân đang bận" }), /role="alert"/);
});
