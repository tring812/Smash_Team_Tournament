/** Kiểm thử gộp request, huỷ độc lập và không cập nhật dữ liệu từ lượt tải cũ. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";
const loadModule = createRequire(import.meta.url);
Module._extensions[".ts"] = (mod, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  mod._compile(outputText, filename);
};
const { createSharedRead } = loadModule("../app/lib/sharedRead.ts");
const { createPollTask } = loadModule("../app/lib/pollTask.ts");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("ba GET trùng đang chạy chỉ tải một lần và nhận JSON độc lập", async () => {
  const reads = createSharedRead();
  const result = deferred();
  let count = 0;
  const load = () => { count++; return result.promise; };
  const pending = [reads.read("/me", load), reads.read("/me", load), reads.read("/me", load)];
  await Promise.resolve();
  assert.equal(count, 1);
  result.resolve({ values: [1] });
  const [a, b, c] = await Promise.all(pending);
  a.values.push(2);
  assert.deepEqual(b, { values: [1] });
  assert.deepEqual(c, b);
});
test("không giữ cache sau khi GET hoàn tất", async () => {
  const reads = createSharedRead();
  let count = 0;
  const load = async () => ++count;
  assert.equal(await reads.read("/me", load), 1);
  assert.equal(await reads.read("/me", load), 2);
});
test("hai đường dẫn khác nhau không bị gộp", async () => {
  const reads = createSharedRead();
  let count = 0;
  await Promise.all([reads.read("/a", async () => ++count), reads.read("/b", async () => ++count)]);
  assert.equal(count, 2);
});
test("huỷ một người đọc không huỷ người đọc còn lại", async () => {
  const reads = createSharedRead();
  const result = deferred();
  const first = new AbortController();
  let sharedSignal;
  const load = (signal) => { sharedSignal = signal; return result.promise; };
  const a = reads.read("/a", load, first.signal);
  const b = reads.read("/a", load);
  const rejected = assert.rejects(a, { name: "AbortError" });
  await Promise.resolve();
  first.abort();
  await rejected;
  assert.equal(sharedSignal.aborted, false);
  result.resolve({ ok: true });
  assert.deepEqual(await b, { ok: true });
});
test("huỷ mọi người đọc sẽ huỷ fetch; yêu cầu mới không nhận lượt đã huỷ", async () => {
  const reads = createSharedRead();
  const controller = new AbortController();
  const result = deferred();
  let signal;
  const a = reads.read("/a", (s) => { signal = s; return result.promise; }, controller.signal);
  const rejected = assert.rejects(a, { name: "AbortError" });
  await Promise.resolve();
  controller.abort();
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(await reads.read("/a", async () => "mới"), "mới");
  result.resolve("cũ");
});
test("signal đã huỷ không khởi chạy GET", async () => {
  const reads = createSharedRead();
  const controller = new AbortController();
  controller.abort();
  let started = false;
  await assert.rejects(reads.read("/a", async () => { started = true; }, controller.signal), { name: "AbortError" });
  assert.equal(started, false);
});
test("clear ngăn dùng chung dữ liệu trước khi ghi hoặc đổi phiên", async () => {
  const reads = createSharedRead();
  const old = deferred();
  const a = reads.read("/me", () => old.promise);
  reads.clear();
  assert.deepEqual(await reads.read("/me", async () => ({ user: "mới" })), { user: "mới" });
  old.resolve({ user: "cũ" });
  assert.deepEqual(await a, { user: "cũ" });
  assert.deepEqual(await reads.read("/me", async () => ({ user: "hiện tại" })), { user: "hiện tại" });
});
test("GET lỗi không bị cache và lần sau vẫn thử lại được", async () => {
  const reads = createSharedRead();
  await assert.rejects(reads.read("/a", async () => { throw new Error("mất mạng"); }), /mất mạng/);
  assert.equal(await reads.read("/a", async () => "đã kết nối"), "đã kết nối");
});
test("poll không chồng request; nhiều tín hiệu dồn thành một lượt kế tiếp", async () => {
  const requests = [];
  const data = [];
  const task = createPollTask(() => { const d = deferred(); requests.push(d); return d.promise; }, (v) => data.push(v), assert.fail);
  const first = task.refresh();
  void task.refresh();
  void task.refresh();
  assert.equal(requests.length, 1);
  requests[0].resolve("lượt 1");
  await Promise.resolve();
  assert.equal(requests.length, 2);
  requests[1].resolve("lượt 2");
  await first;
  assert.deepEqual(data, ["lượt 1", "lượt 2"]);
  task.dispose();
});
test("đổi trang huỷ poll cũ, không phát dữ liệu dù loader bỏ qua signal", async () => {
  const result = deferred();
  const data = [];
  let signal;
  const task = createPollTask((s) => { signal = s; return result.promise; }, (v) => data.push(v), assert.fail);
  const pending = task.refresh();
  void task.refresh();
  task.dispose();
  assert.equal(signal.aborted, true);
  result.resolve("dữ liệu cũ");
  await pending;
  await task.refresh();
  assert.deepEqual(data, []);
});
test("poll báo lỗi thật và có thể tải lại thành công", async () => {
  const errors = [];
  const data = [];
  let count = 0;
  const task = createPollTask(async () => { if (!count++) throw new Error("mất mạng"); return "đã kết nối"; }, (v) => data.push(v), (e) => errors.push(e.message));
  await task.refresh();
  await task.refresh();
  assert.deepEqual(errors, ["mất mạng"]);
  assert.deepEqual(data, ["đã kết nối"]);
  task.dispose();
});
test("poll đã huỷ không phát lỗi AbortError", async () => {
  const result = deferred();
  const errors = [];
  const task = createPollTask(() => result.promise, assert.fail, (e) => errors.push(e));
  const pending = task.refresh();
  task.dispose();
  result.reject(new DOMException("Đã huỷ", "AbortError"));
  await pending;
  assert.deepEqual(errors, []);
});

test("api tích hợp: gộp GET nhưng giữ cookie/CSRF và không gộp thao tác ghi", async (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ count: calls.length }), { headers: { "content-type": "application/json" } });
  });
  const { api } = loadModule("../app/lib/api.ts");
  assert.deepEqual(await Promise.all([api("/perf-test"), api("/perf-test")]), [{ count: 1 }, { count: 1 }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.headers["X-Requested-With"], "fetch");
  await Promise.all([api("/perf-test", { method: "POST", body: { version: 1 } }), api("/perf-test", { method: "POST", body: { version: 1 } })]);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].init.body, '{"version":1}');
  await api("/perf-test");
  assert.equal(calls.length, 4);
});
test("api không chia sẻ request giữa các lượt chạy phía máy chủ", async (t) => {
  const previousWindow = globalThis.window;
  delete globalThis.window;
  t.after(() => { if (previousWindow !== undefined) globalThis.window = previousWindow; });
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    count++;
    return new Response('{"ok":true}');
  });
  const { api } = loadModule("../app/lib/api.ts");
  await Promise.all([api("/server-test"), api("/server-test")]);
  assert.equal(count, 2);
});
