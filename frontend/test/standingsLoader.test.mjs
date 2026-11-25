/** Kiểm thử tương thích API bảng xếp hạng, thời hạn ghi nhớ và huỷ request. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync(new URL("../app/lib/standingsLoader.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

class ApiError extends Error {
  constructor(status, code, message, body = {}) {
    super(message);
    this.name = "ApiError";
    Object.assign(this, { status, code, body });
  }
}

const missingRoute = () => new ApiError(404, "NOT_FOUND", "API không tồn tại", { title: "API không tồn tại" });
const aggregatePath = (id = "giai-1") => `/tournaments/${id}/standings`;
const categoryPath = (id) => `/categories/${id}/standings`;
const category = (id, stage = "groups") => ({ id, stage });
const groups = (id) => [{ groupId: `bang-${id}`, name: "Bảng A", complete: false, standings: [] }];
const plain = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function harness(defaultRequest = async () => { throw new Error("Request chưa được cấu hình"); }) {
  const testModule = { exports: {} };
  vm.runInNewContext(source, {
    exports: testModule.exports,
    module: testModule,
    require: (name) => {
      assert.equal(name, "./api");
      return { api: defaultRequest, ApiError };
    },
    AbortController,
    DOMException,
  });
  return testModule.exports.createStandingsLoader;
}

test("API tổng hợp thành công chỉ gọi một request và không lưu dữ liệu kết quả", async () => {
  const calls = [];
  const controller = new AbortController();
  const load = harness()(async (path, init) => {
    calls.push({ path, init });
    return [{ categoryId: "doi-nam", groups: groups(calls.length) }];
  });
  const categories = [category("chua-boc", "setup"), category("doi-nam"), category("doi-nu", "completed")];
  assert.deepEqual(plain(await load("giai-1", categories, controller.signal)), [
    { categoryId: "doi-nam", groups: groups(1) },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, aggregatePath());
  assert.equal(calls[0].init.signal, controller.signal);
  assert.deepEqual(plain(await load("giai-1", categories)), [{ categoryId: "doi-nam", groups: groups(2) }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, aggregatePath());
});

test("factory mặc định dùng api được cung cấp bởi mô-đun", async () => {
  const calls = [];
  const load = harness(async (path) => { calls.push(path); return []; })();
  assert.deepEqual(plain(await load("giai-2", [])), []);
  assert.deepEqual(calls, [aggregatePath("giai-2")]);
});

test("đúng lỗi thiếu route mới chuyển API cũ, bỏ nội dung setup và chuẩn hoá kết quả", async () => {
  const calls = [];
  const controller = new AbortController();
  const categories = [category("doi-nu", "knockout"), category("chua-boc", "setup"), category("doi-nam", "completed")];
  const load = harness()(async (path, init) => {
    calls.push({ path, signal: init.signal });
    if (path === aggregatePath()) throw missingRoute();
    return path === categoryPath("doi-nu") ? groups("nu") : [];
  });
  assert.deepEqual(plain(await load("giai-1", categories, controller.signal)), [
    { categoryId: "doi-nu", groups: groups("nu") },
    { categoryId: "doi-nam", groups: [] },
  ]);
  assert.deepEqual(calls.map(({ path }) => path), [aggregatePath(), categoryPath("doi-nu"), categoryPath("doi-nam")]);
  assert.ok(calls.every(({ signal }) => signal === controller.signal));
  assert.deepEqual(categories, [category("doi-nu", "knockout"), category("chua-boc", "setup"), category("doi-nam", "completed")]);
});

const nonFallbackErrors = [
  ["404 thiếu giải", () => new ApiError(404, "NOT_FOUND", "Không tìm thấy giải", { title: "Không tìm thấy giải" })],
  ["404 không có title dù message giống lỗi route", () => new ApiError(404, "NOT_FOUND", "API không tồn tại")],
  ["404 title có khoảng trắng thừa", () => new ApiError(404, "NOT_FOUND", "Có lỗi", { title: "API không tồn tại " })],
  ["404 title sai kiểu", () => new ApiError(404, "NOT_FOUND", "Có lỗi", { title: ["API không tồn tại"] })],
  ["404 mã lỗi khác", () => new ApiError(404, "TOURNAMENT_NOT_FOUND", "Có lỗi", { title: "API không tồn tại" })],
  ["403 không đủ quyền", () => new ApiError(403, "NOT_FOUND", "Có lỗi", { title: "API không tồn tại" })],
  ["401 chưa đăng nhập", () => new ApiError(401, "NOT_FOUND", "Có lỗi", { title: "API không tồn tại" })],
  ["500 lỗi máy chủ", () => new ApiError(500, "NOT_FOUND", "Có lỗi", { title: "API không tồn tại" })],
  ["đối tượng giống ApiError", () => ({ name: "ApiError", status: 404, code: "NOT_FOUND", body: { title: "API không tồn tại" } })],
  ["lỗi mạng", () => new TypeError("Mất kết nối")],
  ["lỗi huỷ", () => new DOMException("Đã huỷ", "AbortError")],
];

for (const [name, makeError] of nonFallbackErrors) {
  test(`${name}: giữ nguyên lỗi, không fallback và lần sau vẫn thử API tổng hợp`, async () => {
    const error = makeError();
    const calls = [];
    const load = harness()(async (path) => {
      calls.push(path);
      if (calls.length === 1) throw error;
      return [];
    });
    await assert.rejects(load("giai-1", [category("doi-nam")]), (actual) => actual === error);
    assert.deepEqual(calls, [aggregatePath()]);
    assert.deepEqual(plain(await load("giai-1", [category("doi-nam")])), []);
    assert.deepEqual(calls, [aggregatePath(), aggregatePath()]);
  });
}

test("ghi nhớ khả năng API trong 60 giây, không giữ dữ liệu và thử tổng hợp đúng khi hết hạn", async () => {
  let time = 1000;
  let aggregateCalls = 0;
  let legacyCalls = 0;
  const calls = [];
  const load = harness()(async (path) => {
    calls.push(path);
    if (path.startsWith("/tournaments/")) {
      aggregateCalls++;
      if (aggregateCalls === 1) throw missingRoute();
      return [{ categoryId: "doi-nam", groups: groups("tong-hop") }];
    }
    return groups(++legacyCalls);
  }, () => time);
  assert.deepEqual(plain(await load("giai-1", [category("doi-nam")])), [{ categoryId: "doi-nam", groups: groups(1) }]);
  time = 60999;
  assert.deepEqual(plain(await load("giai-2", [category("doi-nam")])), [{ categoryId: "doi-nam", groups: groups(2) }]);
  assert.equal(aggregateCalls, 1);
  time = 61000;
  assert.deepEqual(plain(await load("giai-2", [category("doi-nam")])), [{ categoryId: "doi-nam", groups: groups("tong-hop") }]);
  assert.deepEqual(calls, [aggregatePath(), categoryPath("doi-nam"), categoryPath("doi-nam"), aggregatePath("giai-2")]);
  assert.equal(aggregateCalls, 2);
  assert.equal(legacyCalls, 2);
});

test("API vẫn thiếu sau hết hạn thì gia hạn chế độ cũ thêm 60 giây", async () => {
  let time = 0;
  let aggregateCalls = 0;
  let legacyCalls = 0;
  const load = harness()(async (path) => {
    if (path === aggregatePath()) { aggregateCalls++; throw missingRoute(); }
    legacyCalls++;
    return [];
  }, () => time);
  await load("giai-1", [category("doi-nam")]);
  time = 60000;
  await load("giai-1", [category("doi-nam")]);
  time = 119999;
  await load("giai-1", [category("doi-nam")]);
  assert.equal(aggregateCalls, 2);
  assert.equal(legacyCalls, 3);
  time = 120000;
  await load("giai-1", [category("doi-nam")]);
  assert.equal(aggregateCalls, 3);
});

test("hai factory không chia sẻ trạng thái thiếu API", async () => {
  const createStandingsLoader = harness();
  const first = createStandingsLoader(async (path) => {
    if (path === aggregatePath()) throw missingRoute();
    return [];
  });
  await first("giai-1", [category("doi-nam")]);
  const calls = [];
  const second = createStandingsLoader(async (path) => { calls.push(path); return []; });
  await second("giai-1", [category("doi-nam")]);
  assert.deepEqual(calls, [aggregatePath()]);
});

for (const [name, categories] of [
  ["không có nội dung", []],
  ["chưa nội dung nào bốc thăm", [category("mot", "setup"), category("hai", "setup")]],
  ["đang vòng bảng", [category("mot", "groups")]],
  ["đang loại trực tiếp", [category("mot", "knockout")]],
  ["đã hoàn thành", [category("mot", "completed")]],
  ["nhiều giai đoạn", [category("ba", "completed"), category("mot", "setup"), category("hai", "groups"), category("bon", "knockout")]],
]) {
  test(`API cũ xử lý danh sách ${name} và giữ cả nội dung có bảng rỗng`, async () => {
    const calls = [];
    const load = harness()(async (path) => {
      calls.push(path);
      if (path === aggregatePath()) throw missingRoute();
      return [];
    });
    const drawn = categories.filter(({ stage }) => stage !== "setup");
    assert.deepEqual(plain(await load("giai-1", categories)), drawn.map(({ id }) => ({ categoryId: id, groups: [] })));
    assert.deepEqual(calls, [aggregatePath(), ...drawn.map(({ id }) => categoryPath(id))]);
  });
}

test("lỗi API từng nội dung được truyền nguyên vẹn, không đổi thành danh sách rỗng", async () => {
  const error = new ApiError(403, "FORBIDDEN", "Không đủ quyền");
  const calls = [];
  const load = harness()(async (path) => {
    calls.push(path);
    if (path === aggregatePath()) throw missingRoute();
    throw error;
  });
  await assert.rejects(load("giai-1", [category("doi-nam")]), (actual) => actual === error);
  assert.deepEqual(calls, [aggregatePath(), categoryPath("doi-nam")]);
});

test("signal đã huỷ không gửi request kể cả khi đang ghi nhớ chế độ API cũ", async () => {
  const calls = [];
  const load = harness()(async (path) => {
    calls.push(path);
    if (path === aggregatePath()) throw missingRoute();
    return [];
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(load("giai-1", [category("doi-nam")], controller.signal), { name: "AbortError" });
  assert.deepEqual(calls, []);
  await load("giai-1", [category("doi-nam")]);
  const before = calls.length;
  await assert.rejects(load("giai-1", [category("doi-nam")], controller.signal), { name: "AbortError" });
  assert.equal(calls.length, before);
});

test("huỷ request tổng hợp truyền signal và không kích hoạt fallback", async () => {
  const controller = new AbortController();
  const calls = [];
  const load = harness()((path, { signal }) => {
    calls.push(path);
    assert.equal(signal, controller.signal);
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Đã huỷ", "AbortError")), { once: true });
    });
  });
  const pending = load("giai-1", [category("doi-nam")], controller.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await flush();
  controller.abort();
  await rejected;
  assert.deepEqual(calls, [aggregatePath()]);
});

test("API cũ chạy tối đa bốn request đồng thời và giữ thứ tự dù phản hồi đảo ngược", async () => {
  const categories = Array.from({ length: 10 }, (_, i) => category(`noi-dung-${i}`));
  const controller = new AbortController();
  const requests = [];
  let active = 0;
  let peak = 0;
  const load = harness()(async (path, { signal }) => {
    assert.equal(signal, controller.signal);
    if (path === aggregatePath()) throw missingRoute();
    const result = deferred();
    requests.push({ path, ...result });
    peak = Math.max(peak, ++active);
    try { return await result.promise; }
    finally { active--; }
  });
  const pending = load("giai-1", categories, controller.signal);
  await flush();
  assert.equal(requests.length, 4);
  assert.equal(active, 4);
  for (const [start, end] of [[0, 4], [4, 8], [8, 10]]) {
    assert.equal(requests.length, end);
    for (let i = end - 1; i >= start; i--) {
      assert.equal(requests[i].path, categoryPath(categories[i].id));
      requests[i].resolve(groups(categories[i].id));
    }
    await flush();
    assert.ok(active <= 4);
  }
  assert.deepEqual(plain(await pending), categories.map(({ id }) => ({ categoryId: id, groups: groups(id) })));
  assert.equal(peak, 4);
  assert.equal(active, 0);
});

test("huỷ API cũ huỷ bốn request đang chạy và không khởi chạy nội dung còn chờ", async () => {
  const controller = new AbortController();
  const calls = [];
  const load = harness()(async (path, { signal }) => {
    assert.equal(signal, controller.signal);
    calls.push(path);
    if (path === aggregatePath()) throw missingRoute();
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Đã huỷ", "AbortError")), { once: true });
    });
  });
  const pending = load("giai-1", Array.from({ length: 9 }, (_, i) => category(`noi-dung-${i}`)), controller.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await flush();
  assert.equal(calls.length, 5);
  controller.abort();
  await rejected;
  await flush();
  assert.equal(calls.length, 5);
});
