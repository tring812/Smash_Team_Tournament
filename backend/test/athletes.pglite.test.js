'use strict';
/**
 * Hồ sơ VĐV (MSSV + SĐT) và chia bảng có sẵn — PGlite.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }

const svc = require('../src/services/tournamentService');
const courts = require('../src/services/courtService');
const ath = require('../src/services/athleteService');

const ADMIN = { id: '00000000-0000-4000-8000-0000000000d1', full_name: 'Admin', role: 'admin' };
const REF = { id: '00000000-0000-4000-8000-0000000000d2', full_name: 'TT', role: 'user' };
const future = (d) => new Date(Date.now() + d * 86_400_000).toISOString();
const MIGRATIONS = path.join(__dirname, '..', 'migrations');

async function rejectsWith(p, status, code, re) {
  await assert.rejects(p, (err) => {
    assert.equal(err.status, status, `expected ${status}, got ${err.status}: ${err.message}`);
    if (code) assert.equal(err.code, code);
    if (re) assert.match(err.message, re);
    return true;
  });
}

test('chuẩn hoá SĐT và MSSV', () => {
  assert.equal(ath.normalizePhone('+84 901-234-567'), '0901234567');
  assert.equal(ath.normalizePhone('84901234567'), '0901234567');
  assert.equal(ath.normalizePhone('901234567'), '0901234567', 'Excel bỏ số 0 đầu');
  assert.equal(ath.normalizePhone('0901 234 567'), '0901234567');
  assert.equal(ath.normalizePhone('12345'), null);
  assert.equal(ath.normalizeStudentId(' 2152-0001 '), '21520001');
  assert.equal(ath.normalizeStudentId('ab12'), 'AB12');
  assert.equal(ath.normalizeStudentId('x'), null);
});

describe('Hồ sơ VĐV & bảng có sẵn (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  /** @type {any} */ let pool;
  /** @type {any} */ let t;
  /** @type {any} */ let ms;
  /** @type {any} */ let xd;

  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    for (const f of fs.readdirSync(MIGRATIONS).sort()) await pool.query(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    for (const u of [ADMIN, REF]) await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
    t = await svc.createTournament(pool, ADMIN, { slug: 'uit-cup', name: 'UIT Cup', startsAt: future(7), courts: 4 });
    await svc.upsertStaff(pool, ADMIN, t.id, { userId: REF.id, role: 'referee' });
    ms = await svc.createCategory(pool, ADMIN, t.id, { code: 'MS', name: 'Đơn nam', isDoubles: false, groupCount: 2 });
    xd = await svc.createCategory(pool, ADMIN, t.id, { code: 'XD', name: 'Đôi nam nữ', isDoubles: true, groupCount: 1 });
  });
  after(async () => { await pool?.end(); });

  const athletesOf = () => ath.listAthletes(pool, ADMIN, t.id);

  test('cùng MSSV ở 2 nội dung = 1 người; 2 người trùng tên khác MSSV = 2 người', async () => {
    await svc.addEntries(pool, ADMIN, ms.id, [
      { player1Name: 'Nguyễn An', player1StudentId: '21520001', player1Phone: '0901234567' },
      { player1Name: 'Nguyễn An', player1StudentId: '21520002' }, // người khác, trùng tên
      { player1Name: 'Lê Bình', player1Phone: '0902000000' },
      { player1Name: 'Trần Chi', player1StudentId: '21520004' },
    ]);
    // Ở nội dung đôi chỉ ghi SĐT dạng +84 của An #1 → vẫn nhận đúng người.
    await svc.addEntries(pool, ADMIN, xd.id, [
      { player1Name: 'nguyễn  an', player1Phone: '+84 901 234 567', player2Name: 'Mai Hoa', player2StudentId: '21529999' },
      { player1Name: 'Lê Bình', player1Phone: '0902000000', player2Name: 'Đỗ Lan' },
    ]);
    const list = await athletesOf();
    const ans = list.filter((a) => a.full_name === 'Nguyễn An');
    assert.equal(ans.length, 2, 'hai người tên Nguyễn An');
    const an1 = ans.find((a) => a.student_id === '21520001');
    assert.deepEqual(an1.entries.map((e) => e.categoryCode).sort(), ['MS', 'XD']);
    assert.equal(list.find((a) => a.full_name === 'Lê Bình').entries.length, 2);
  });

  test('tên mơ hồ, MSSV/SĐT mâu thuẫn, đăng ký trùng nội dung bị chặn; cả lô không thêm gì', async () => {
    const before = (await svc.listEntries(pool, ms.id)).length;
    await rejectsWith(svc.addEntries(pool, ADMIN, xd.id, [{ player1Name: 'Nguyễn An', player2Name: 'Ai Đó' }]), 422, null, /Dòng 1: Có 2 VĐV tên/);
    await rejectsWith(svc.addEntries(pool, ADMIN, ms.id, [{ player1Name: 'X', player1StudentId: '21520001', player1Phone: '0902000000' }]), 409, 'ATHLETE_MISMATCH');
    await rejectsWith(svc.addEntries(pool, ADMIN, ms.id, [
      { player1Name: 'Mới Toanh', player1StudentId: '21521111' },
      { player1Name: 'Trần Chi', player1StudentId: '21520004' },
    ]), 409, 'ATHLETE_ALREADY_ENTERED', /Dòng 2/);
    await rejectsWith(svc.addEntries(pool, ADMIN, xd.id, [{ player1Name: 'A', player1StudentId: 'SV001', player2Name: 'A', player2StudentId: 'SV001' }]), 422);
    await rejectsWith(svc.addEntries(pool, ADMIN, ms.id, [{ player1Name: 'Y', player1StudentId: '!' }]), 422, null, /MSSV/);
    assert.equal((await svc.listEntries(pool, ms.id)).length, before, 'lô lỗi không để lại đội nào');
    assert.ok(!(await athletesOf()).some((a) => a.full_name === 'Mới Toanh'), 'không để lại hồ sơ rác');
  });

  test('dữ liệu cá nhân chỉ BTC thấy; sửa tên VĐV cập nhật mọi đội', async () => {
    const pub = await svc.listEntries(pool, ms.id);
    assert.ok(pub.every((e) => !('phone' in e) && !('student_id' in e)));
    await rejectsWith(ath.listAthletes(pool, REF, t.id), 403);
    const binh = (await athletesOf()).find((a) => a.full_name === 'Lê Bình');
    await ath.updateAthlete(pool, ADMIN, binh.id, { fullName: 'Lê Văn Bình', studentId: '21520003' });
    const names = [...(await svc.listEntries(pool, ms.id)), ...(await svc.listEntries(pool, xd.id))].map((e) => e.name).join('|');
    assert.match(names, /Lê Văn Bình/);
    assert.doesNotMatch(names, /Lê Bình\b/);
    await rejectsWith(ath.updateAthlete(pool, ADMIN, binh.id, { studentId: '21520004' }), 409, 'ATHLETE_DUPLICATE');
    const ev = (await svc.listEvents(pool, ADMIN, t.id)).find((e) => e.action === 'athlete_update');
    assert.ok(!JSON.stringify(ev.details).includes('21520003'), 'nhật ký không chứa MSSV');
  });

  test('chống trùng lịch theo NGƯỜI: An #1 đang ở sân → không gọi được trận XD của An #1, nhưng An #2 thì được', async () => {
    await svc.drawGroups(pool, ADMIN, ms.id);
    await svc.addEntries(pool, ADMIN, xd.id, [{ player1Name: 'Phạm Dũng', player2Name: 'Võ Em' }]);
    await svc.drawGroups(pool, ADMIN, xd.id);
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'published' });
    const all = await svc.listMatches(pool, t.id);
    const an1 = (await athletesOf()).find((a) => a.student_id === '21520001');
    const entryIds = new Set(an1.entries.map((e) => e.entryId));
    const msAn1 = all.find((m) => m.category.code === 'MS' && (entryIds.has(m.a.id) || entryIds.has(m.b.id)));
    const xdAn1 = all.find((m) => m.category.code === 'XD' && (entryIds.has(m.a.id) || entryIds.has(m.b.id)) && !m.a.name.includes('Lê') && !m.b.name.includes('Lê'));
    await courts.callMatch(pool, ADMIN, msAn1.id, { court: 1 });
    await rejectsWith(courts.callMatch(pool, ADMIN, xdAn1.id, { court: 2 }), 409, 'PLAYER_BUSY', /Nguyễn An/);
    const an2Entry = (await athletesOf()).find((a) => a.student_id === '21520002').entries[0].entryId;
    const msAn2 = all.find((m) => m.id !== msAn1.id && m.category.code === 'MS' && (m.a.id === an2Entry || m.b.id === an2Entry)
      && ![m.a.id, m.b.id].some((x) => x === msAn1.a.id || x === msAn1.b.id));
    if (msAn2) await courts.callMatch(pool, ADMIN, msAn2.id, { court: 3 }); // người trùng tên KHÔNG bị coi là đang bận
  });

  test('chia bảng có sẵn: đúng đội, tên "Bảng A" → A, số bảng cập nhật; thiếu/lặp đội bị từ chối', async () => {
    const ws = await svc.createCategory(pool, ADMIN, t.id, { code: 'WS', name: 'Đơn nữ', isDoubles: false, groupCount: 4 });
    const added = await svc.addEntries(pool, ADMIN, ws.id, ['Thu', 'Trang', 'Vy', 'Yến', 'Ánh'].map((n) => ({ player1Name: n })));
    const ids = added.map((e) => e.id);
    await rejectsWith(svc.drawGroups(pool, ADMIN, ws.id, { manual: [{ name: 'A', entryIds: ids.slice(0, 2) }, { name: 'B', entryIds: ids.slice(2, 4) }] }), 422, null, /chưa được xếp/);
    await rejectsWith(svc.drawGroups(pool, ADMIN, ws.id, { manual: [{ name: 'A', entryIds: ids.slice(0, 3) }, { name: 'B', entryIds: ids.slice(2) }] }), 422, null, /2 bảng/);
    await rejectsWith(svc.drawGroups(pool, ADMIN, ws.id, { manual: [{ name: 'A', entryIds: ids.slice(0, 4) }, { name: 'B', entryIds: ids.slice(4) }] }), 422, null, /ít nhất 2/);
    const r = await svc.drawGroups(pool, ADMIN, ws.id, { manual: [{ name: 'Bảng A', entryIds: ids.slice(0, 3) }, { name: 'bảng b', entryIds: ids.slice(3) }] });
    assert.deepEqual(r.groups, [{ name: 'A', size: 3 }, { name: 'B', size: 2 }]);
    assert.equal(r.matchCount, 3 + 1);
    const g = await svc.groupStandings(pool, ws.id);
    assert.deepEqual(g.map((x) => x.standings.map((s) => s.entryId).sort()), [ids.slice(0, 3).sort(), ids.slice(3).sort()]);
    const cat = (await pool.query('SELECT group_count, stage FROM categories WHERE id = $1', [ws.id])).rows[0];
    assert.deepEqual(cat, { group_count: 2, stage: 'groups' });
    const ev = (await svc.listEvents(pool, ADMIN, t.id))[0];
    assert.equal(ev.details.manual, true);
  });

  test('xoá đội / nội dung → xoá hồ sơ không còn dùng (không giữ MSSV/SĐT thừa)', async () => {
    const tmp = await svc.createCategory(pool, ADMIN, t.id, { code: 'TMP', name: 'Tạm', isDoubles: false });
    const [x] = await svc.addEntries(pool, ADMIN, tmp.id, [{ player1Name: 'Người Tạm', player1StudentId: 'TMP0001' },
      { player1Name: 'Trần Chi', player1StudentId: '21520004' }]);
    await svc.removeEntry(pool, ADMIN, x.id);
    assert.ok(!(await athletesOf()).some((a) => a.student_id === 'TMP0001'));
    await svc.deleteCategory(pool, ADMIN, tmp.id);
    assert.ok((await athletesOf()).some((a) => a.student_id === '21520004'), 'người còn ở nội dung khác vẫn giữ');
  });
});

describe('Migration 006: tạo hồ sơ cho dữ liệu cũ (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  test('mỗi tên chuẩn hoá trong một giải → 1 hồ sơ; đội cũ được gắn hồ sơ', async () => {
    const pool = require('../src/db').createPool('pglite:memory');
    try {
      const files = fs.readdirSync(MIGRATIONS).sort();
      for (const f of files.filter((x) => x < '006')) await pool.query(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
      await pool.query(`INSERT INTO users (id, full_name, role) VALUES ($1, 'A', 'admin')`, [ADMIN.id]);
      const t = (await pool.query(`INSERT INTO tournaments (slug, name, starts_at, created_by) VALUES ('old', 'Old Cup', now(), $1) RETURNING id`, [ADMIN.id])).rows[0];
      const c1 = (await pool.query(`INSERT INTO categories (tournament_id, code, name, is_doubles) VALUES ($1, 'MS', 'Đơn', false) RETURNING id`, [t.id])).rows[0];
      const c2 = (await pool.query(`INSERT INTO categories (tournament_id, code, name, is_doubles) VALUES ($1, 'XD', 'Đôi', true) RETURNING id`, [t.id])).rows[0];
      await pool.query(`INSERT INTO entries (category_id, player1_name) VALUES ($1, 'Đức Anh'), ($1, 'Bình')`, [c1.id]);
      await pool.query(`INSERT INTO entries (category_id, player1_name, player2_name) VALUES ($1, 'đức  anh', 'Chi')`, [c2.id]);
      for (const f of files.filter((x) => x >= '006')) await pool.query(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
      const { rows } = await pool.query('SELECT full_name, name_key FROM athletes ORDER BY name_key');
      assert.deepEqual(rows.map((r) => r.name_key), ['bình', 'chi', 'đức anh']);
      const unlinked = await pool.query('SELECT count(*)::int n FROM entries WHERE player1_athlete_id IS NULL OR (player2_name IS NOT NULL AND player2_athlete_id IS NULL)');
      assert.equal(unlinked.rows[0].n, 0);
      const same = await pool.query(`SELECT count(DISTINCT player1_athlete_id)::int n FROM entries WHERE player1_name ILIKE '%anh'`);
      assert.equal(same.rows[0].n, 1, '"Đức Anh" và "đức  anh" là một hồ sơ');
      assert.equal(ath.nameKeyOf('Đức  Anh '), 'đức anh', 'JS khớp SQL');
    } finally {
      await pool.end();
    }
  });
});
