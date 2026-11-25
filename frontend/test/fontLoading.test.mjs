/** Chặn việc đưa font ngoài và tệp quá lớn trở lại đường tải ban đầu. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("font tự phục vụ, preload và swap cho cả hai họ chữ", () => {
  assert.match(layout, /from "next\/font\/local"/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.equal((layout.match(/display: "swap"/g) ?? []).length, 2);
  assert.equal((layout.match(/preload: true/g) ?? []).length, 2);
  assert.match(layout, /weight: "100 900"/);
});

test("font dự phòng giữ metric cũ để tránh tự thay đổi bố cục khi swap", () => {
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.equal((layout.match(/adjustFontFallback: false/g) ?? []).length, 2);
  for (const [family, size] of [["Inter", "107.12"], ["Barlow", "76.49"]]) {
    assert.ok(layout.includes(`"Red Line ${family} Fallback"`));
    assert.match(css, new RegExp(`font-family: "Red Line ${family} Fallback";[^}]*size-adjust: ${size.replace(".", "\\.")}%`, "s"));
  }
});

test("năm WOFF2 gộp Latin/tiếng Việt có tổng dung lượng dưới 140 KB", () => {
  const paths = [...layout.matchAll(/path: "(\.\/fonts\/[^"\s]+\.woff2)"/g)].map((m) => m[1]);
  assert.equal(paths.length, 5);
  let total = 0;
  for (const path of paths) {
    const bytes = fs.readFileSync(new URL(`../app/${path}`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), "wOF2", path);
    assert.match(path, /latin-vietnamese\.woff2$/);
    total += bytes.length;
  }
  assert.ok(total < 140000, `Font vượt ngân sách: ${total} byte`);
});
