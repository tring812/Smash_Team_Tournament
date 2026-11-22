'use strict';
/**
 * Biên bản diễn biến điểm: người giao / vị trí theo luật đánh đôi BWF và hàng ghi số trên biên bản.
 * Ví dụ chuẩn = mẫu biên bản giấy của BTC (CAP_NHAT_CHUC_NANG mục 1.3).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { replay, applyEvent, emptyState, RallyError } = require('../src/domain/rally');

const R21 = { pointsToWin: 21, maxPoints: 30, gamesToWin: 2 };

/** Dựng chuỗi sự kiện: start rồi các đoạn [đội thắng, số pha]. */
function events(start, segments) {
  const out = [{ seq: 1, type: 'start', ...start }];
  for (const [side, n] of segments) for (let i = 0; i < n; i += 1) out.push({ seq: out.length + 1, type: 'point', side });
  return out;
}

describe('rally: biên bản đánh đôi theo mẫu giấy', () => {
  // Đội a: a1 = Cường, a2 = Hiếu · Đội b: b1 = Phúc, b2 = Hằng · Hiếu giao (G), Hằng nhận (N).
  const segs = [['a', 4], ['b', 7], ['a', 3], ['b', 5], ['a', 8], ['b', 4], ['a', 4], ['b', 5]];
  const st = replay(events({ server: 'a2', receiver: 'b2' }, segs), R21, true);
  const block = st.sheet[0];

  test('cột 0: G ở Hiếu, N ở Hằng', () => {
    assert.equal(block.server, 'a2');
    assert.equal(block.receiver, 'b2');
  });

  test('mỗi pha một cột; số ghi ở hàng người giao pha kế tiếp — y hệt mẫu', () => {
    const expected = [
      ['a2', [1, 2, 3, 4]], // Hiếu: đội giao thắng → cùng người giao
      ['b1', [1, 2, 3, 4, 5, 6, 7]], // Phúc: 1 lẻ → ô trái
      ['a1', [5, 6, 7]], // Cường: 5 lẻ → ô trái
      ['b2', [8, 9, 10, 11, 12]], // Hằng: 8 chẵn → ô phải
      ['a2', [8, 9, 10, 11, 12, 13, 14, 15]], // Hiếu: 8 chẵn → ô phải
      ['b1', [13, 14, 15, 16]], // Phúc: 13 lẻ → ô trái
      ['a1', [16, 17, 18, 19]], // Cường: 16 chẵn → ô phải
      ['b2', [17, 18, 19, 20, 21]], // Hằng: 17 lẻ → ô trái; đội b thắng 21–19
    ];
    const got = block.cols.map((c) => [c.row, c.side === 'a' ? c.score[0] : c.score[1]]);
    const want = expected.flatMap(([row, nums]) => nums.map((n) => [row, n]));
    assert.deepEqual(got, want);
    assert.equal(block.cols.length, 40);
  });

  test('tỉ số game 19–21, đội b thắng game; game sau cần chọn người giao lại', () => {
    assert.deepEqual(st.games, [[19, 21]]);
    assert.equal(st.active, false);
    assert.equal(st.matchOver, false);
    assert.throws(() => applyEvent(st, { seq: 41, type: 'point', side: 'a' }, R21, true), RallyError);
  });

  test('vạch nghỉ đúng 1 lần, ở pha đầu tiên chạm 11', () => {
    const marks = block.cols.filter((c) => c.interval);
    assert.equal(marks.length, 1);
    assert.deepEqual(marks[0].score, [7, 11]);
  });
});

describe('rally: đơn, sửa người giao, BTC sửa tay', () => {
  test('đánh đơn: bên thắng pha giao pha sau', () => {
    const st = replay(events({ server: 'a1' }, [['a', 2], ['b', 1], ['a', 1]]), R21, false);
    assert.deepEqual(st.sheet[0].cols.map((c) => c.row), ['a1', 'a1', 'b1', 'a1']);
    assert.equal(st.receiver, 'b1');
    assert.throws(() => applyEvent(emptyState(), { seq: 1, type: 'start', server: 'a2' }, R21, false), RallyError);
  });

  test('sửa người giao: số của pha mới nhất chuyển sang hàng người giao đúng, pha sau tính theo người mới', () => {
    let st = replay(events({ server: 'a1', receiver: 'b1' }, [['b', 1]]), R21, true);
    assert.equal(st.server, 'b2'); // 1 lẻ → ô trái của đội b là b2 (b1 nhận ở ô phải)
    st = applyEvent(st, { seq: 3, type: 'fix_server', server: 'b1' }, R21, true);
    assert.equal(st.sheet[0].cols[0].row, 'b1');
    assert.equal(st.sheet[0].cols[0].fixed, true);
    st = applyEvent(st, { seq: 4, type: 'point', side: 'b' }, R21, true);
    assert.equal(st.server, 'b1', 'đội giao thắng → cùng người giao');
  });

  test('người nhận phải ở đội kia; điểm trước khi chọn người giao bị từ chối', () => {
    assert.throws(() => applyEvent(emptyState(), { seq: 1, type: 'start', server: 'a1', receiver: 'a2' }, R21, true), RallyError);
    assert.throws(() => applyEvent(emptyState(), { seq: 1, type: 'point', side: 'a' }, R21, true), RallyError);
  });

  test('BTC sửa tay giữa game: tỉ số theo bản sửa, điểm sau tính tiếp', () => {
    let st = replay(events({ server: 'a1', receiver: 'b1' }, [['a', 3]]), R21, true);
    st = applyEvent(st, { seq: 5, type: 'override', games: [[10, 8]] }, R21, true);
    st = applyEvent(st, { seq: 6, type: 'point', side: 'a' }, R21, true);
    assert.deepEqual(st.games, [[11, 8]]);
    assert.equal(st.sheet[0].cols.find((c) => c.kind === 'override')?.seq, 5);
  });

  test('hết trận thì không bắt đầu game mới', () => {
    const r1 = { pointsToWin: 5, maxPoints: 7, gamesToWin: 1 };
    const st = replay(events({ server: 'a1', receiver: 'b1' }, [['a', 5]]), r1, true);
    assert.equal(st.matchOver, true);
    assert.throws(() => applyEvent(st, { seq: 7, type: 'start', server: 'a1', receiver: 'b1' }, r1, true), RallyError);
  });
});
