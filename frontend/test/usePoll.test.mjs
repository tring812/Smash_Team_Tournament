/** Chạy vòng đời hook với effect/timer kiểm soát được, không cần thêm thư viện test React. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync(new URL("../app/lib/usePoll.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function harness() {
  let current;
  let timerId = 0;
  const timers = new Map();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const changed = (before, after) => !before || !after || before.length !== after.length || before.some((v, i) => !Object.is(v, after[i]));
  const cell = (init) => {
    const index = current.index++;
    return current.cells[index] ??= init();
  };
  const react = {
    useState(initial) {
      const state = cell(() => ({ value: typeof initial === "function" ? initial() : initial }));
      return [state.value, (next) => { state.value = typeof next === "function" ? next(state.value) : next; }];
    },
    useRef(initial) { return cell(() => ({ current: initial })); },
    useCallback(fn, deps) {
      const state = cell(() => ({}));
      if (changed(state.deps, deps)) { state.value = fn; state.deps = deps; }
      return state.value;
    },
    useEffect(fn, deps) {
      const state = cell(() => ({}));
      if (changed(state.deps, deps)) {
        state.deps = deps;
        current.effects.push(() => { state.cleanup?.(); state.cleanup = fn(); });
      }
    },
  };
  const testModule = { exports: {} };
  vm.runInNewContext(source, {
    exports: testModule.exports, module: testModule,
    require: (name) => { assert.equal(name, "react"); return react; },
    document, AbortController,
    setInterval: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearInterval: (id) => timers.delete(id),
  });
  return {
    document, timers,
    mount() {
      const state = { cells: [], effects: [], index: 0 };
      return {
        render(load, deps = [], ms = 10000, key) {
          current = state;
          state.index = 0;
          state.effects = [];
          const out = testModule.exports.usePoll(load, deps, ms, key);
          state.effects.forEach((effect) => effect());
          return out;
        },
        dispose() { state.cells.forEach((state) => state.cleanup?.()); },
      };
    },
  };
}

test("đổi bộ lọc huỷ lượt cũ, response cũ về muộn không ghi đè", async () => {
  const h = harness();
  const hook = h.mount();
  const requests = [];
  const load = (signal) => { const d = deferred(); requests.push({ ...d, signal }); return d.promise; };
  hook.render(load, [1]);
  hook.render(load, [2]);
  assert.equal(requests[0].signal.aborted, true);
  requests[1].resolve("mới");
  await flush();
  assert.equal(hook.render(load, [2]).data, "mới");
  requests[0].resolve("cũ");
  await flush();
  assert.equal(hook.render(load, [2]).data, "mới");
  hook.dispose();
});
test("mutate giữ cập nhật tại chỗ và bỏ response bắt đầu trước thao tác ghi", async () => {
  const h = harness();
  const hook = h.mount();
  const requests = [];
  const load = (signal) => { const d = deferred(); requests.push({ ...d, signal }); return d.promise; };
  hook.render(load);
  requests[0].resolve(1);
  await flush();
  const out = hook.render(load);
  const refreshing = out.refresh();
  out.mutate((value) => value + 1);
  assert.equal(requests[1].signal.aborted, true);
  requests[1].resolve(0);
  await refreshing;
  assert.equal(hook.render(load).data, 2);
  hook.dispose();
});
test("cache công khai vẫn có ngay khi quay lại tab, không mất sau tích hợp", async () => {
  const h = harness();
  const first = h.mount();
  const load = async () => "dữ liệu công khai";
  first.render(load, [], 0, "hub:public");
  await flush();
  first.dispose();
  h.document.visibilityState = "hidden";
  const second = h.mount();
  assert.equal(second.render(load, [], 0, "hub:public").data, "dữ liệu công khai");
  second.dispose();
});
test("đổi nhịp không refetch, ms=0 tắt timer và tab ẩn không tự tải", async () => {
  const h = harness();
  const hook = h.mount();
  let count = 0;
  const load = async () => ++count;
  hook.render(load, [], 0);
  await flush();
  assert.equal(count, 1);
  assert.equal(h.timers.size, 0);
  hook.render(load, [], 30000);
  assert.equal(count, 1);
  assert.equal(h.timers.size, 1);
  h.document.visibilityState = "hidden";
  h.document.dispatchEvent(new Event("visibilitychange"));
  h.timers.forEach((tick) => tick());
  assert.equal(count, 1);
  h.document.visibilityState = "visible";
  h.document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(count, 2);
  hook.dispose();
  assert.equal(h.timers.size, 0);
});
