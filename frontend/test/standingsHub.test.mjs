import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile(
  "TournamentHub.tsx",
  readFileSync(new URL("../app/t/[slug]/TournamentHub.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findNodes(root, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

function variable(name) {
  const nodes = findNodes(source, (node) => ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name) && node.name.text === name);
  assert.equal(nodes.length, 1, `Cần đúng một khai báo ${name}`);
  assert.ok(nodes[0].initializer, `Thiếu giá trị khởi tạo ${name}`);
  return nodes[0].initializer;
}

function identifier(node, name) {
  assert.ok(node && ts.isIdentifier(node), `Cần định danh ${name}`);
  assert.equal(node.text, name);
}

function property(node, object, name) {
  assert.ok(node && ts.isPropertyAccessExpression(node));
  identifier(node.expression, object);
  assert.equal(node.name.text, name);
}

function dependencies(node) {
  assert.ok(node && ts.isArrayLiteralExpression(node), "Danh sách phụ thuộc phải tường minh");
  return node.elements.map((element) => {
    assert.ok(ts.isIdentifier(element), "Phụ thuộc phải là định danh ổn định");
    return element.text;
  });
}

function poll(name) {
  const call = variable(name);
  assert.ok(ts.isCallExpression(call));
  identifier(call.expression, "usePoll");
  return call;
}

test("SSE cấu trúc làm mới metadata, không tải thêm lúc tick bằng không", () => {
  property(variable("refreshTournament"), "t", "refresh");
  const effects = findNodes(source, (node) => ts.isCallExpression(node)
    && ts.isIdentifier(node.expression) && node.expression.text === "useEffect"
    && findNodes(node.arguments[0], (child) => ts.isCallExpression(child)
      && ts.isIdentifier(child.expression) && child.expression.text === "refreshTournament").length > 0);
  assert.equal(effects.length, 1);
  const effect = effects[0];
  assert.deepEqual(dependencies(effect.arguments[1]), ["tick", "refreshTournament"]);
  const callback = effect.arguments[0];
  assert.ok(ts.isArrowFunction(callback) && ts.isBlock(callback.body));
  assert.equal(callback.body.statements.length, 1);
  const guard = callback.body.statements[0];
  assert.ok(ts.isIfStatement(guard) && ts.isBinaryExpression(guard.expression));
  identifier(guard.expression.left, "tick");
  assert.equal(guard.expression.operatorToken.kind, ts.SyntaxKind.GreaterThanToken);
  assert.ok(ts.isNumericLiteral(guard.expression.right));
  assert.equal(guard.expression.right.text, "0");
  assert.equal(guard.elseStatement, undefined);
  assert.ok(ts.isExpressionStatement(guard.thenStatement));
  assert.ok(ts.isVoidExpression(guard.thenStatement.expression));
  const refresh = guard.thenStatement.expression.expression;
  assert.ok(ts.isCallExpression(refresh));
  identifier(refresh.expression, "refreshTournament");
  assert.equal(refresh.arguments.length, 0);
});

test("Khóa nội dung chỉ gồm ID và stage để nhận thay đổi bốc thăm", () => {
  const stringify = variable("standingsCategoriesKey");
  assert.ok(ts.isCallExpression(stringify));
  property(stringify.expression, "JSON", "stringify");
  assert.equal(stringify.arguments.length, 1);
  const map = stringify.arguments[0];
  assert.ok(ts.isCallExpression(map));
  property(map.expression, "cats", "map");
  assert.equal(map.arguments.length, 1);
  const callback = map.arguments[0];
  assert.ok(ts.isArrowFunction(callback));
  assert.equal(callback.parameters.length, 1);
  assert.ok(ts.isIdentifier(callback.parameters[0].name));
  const parameter = callback.parameters[0].name.text;
  assert.ok(ts.isArrayLiteralExpression(callback.body));
  assert.equal(callback.body.elements.length, 2);
  property(callback.body.elements[0], parameter, "id");
  property(callback.body.elements[1], parameter, "stage");
});

test("BXH nhận invalidation ID/stage và kết quả; điểm từng pha không tải lại toàn bộ", () => {
  assert.deepEqual(dependencies(poll("standingsRaw").arguments[1]), [
    "standingsPath", "standingsCategoriesKey", "tick", "resultTick",
  ]);
  assert.deepEqual(dependencies(poll("matches").arguments[1]), ["matchesPath", "tick"]);
  assert.deepEqual(dependencies(poll("t").arguments[1]), ["slug"]);
});

test("Vòng tải BXH truyền metadata hiện tại và tín hiệu hủy cho loader", () => {
  const callback = poll("standingsRaw").arguments[0];
  assert.ok(ts.isArrowFunction(callback));
  assert.equal(callback.parameters.length, 1);
  assert.ok(ts.isIdentifier(callback.parameters[0].name));
  const calls = findNodes(callback.body, (node) => ts.isCallExpression(node)
    && ts.isIdentifier(node.expression) && node.expression.text === "loadStandings");
  assert.equal(calls.length, 1);
  const args = calls[0].arguments;
  assert.equal(args.length, 3);
  assert.ok(ts.isPropertyAccessExpression(args[0]));
  property(args[0].expression, "t", "data");
  assert.equal(args[0].name.text, "id");
  identifier(args[1], "cats");
  identifier(args[2], callback.parameters[0].name.text);
});
