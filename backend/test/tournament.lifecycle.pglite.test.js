'use strict';
/**
 * Sửa / xoá / khôi phục giải (PGlite): chỉ quản trị viên hoặc người tạo được xoá; gõ đúng slug; không xoá giải
 * đang diễn ra; giải đã xoá biến khỏi mọi nơi và khoá mọi thao tác; khôi phục trong 7 ngày; quá hạn thì xoá hẳn
 * dây chuyền; đổi slug.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }

const svc = require('../src/services/tournamentService');
const categorySvc = require('../src/services/categoryService');
const entrySvc = require('../src/services/entryService');
const matchSvc = require('../src/services/matchService');
const courts = require('../src/services/courtService');
const rallies = require('../src/services/rallyService');

const ADMIN = { id: '00000000-0000-4000-8000-0000000000e1', full_name: 'Admin', role: 'admin' };
const CREATOR = { id: '00000000-0000-4000-8000-0000000000e2', full_name: 'Người tạo', role: 'user' };
const ORG = { id: '00000000-0000-4000-8000-0000000000e3', full_name: 'BTC khác', role: 'user' };
const REF = { id: '00000000-0000-4000-8000-0000000000e4', full_name: 'Trọng tài', role: 'user' };
const future = (d) => new Date(Date.now() + d * 86_400_000).toISOString();

async function rejectsWith(p, status, code) {
  await assert.rejects(p, (err) => {
    assert.equal(err.status, status, `expected ${status}, got ${err.status}: ${err.message}`);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

describe('Sửa / xoá / khôi phục giải (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  /** @type {any} */ let pool;

  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).sort()) {
      await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
    }
    for (const u of [ADMIN, CREATOR, ORG, REF]) {
      await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
    }
  });
  after(async () => { await pool?.end(); });

  /** Giải đầy đủ dữ liệu con, người tạo = CREATOR (BTC), thêm ORG làm BTC và REF làm trọng tài. */
  async function fullTournament(slug) {
    const t = await svc.createTournament(pool, ADMIN, { slug, name: `Giải ${slug}`, startsAt: future(7), courts: 2 });
    await pool.query('UPDATE tournaments SET created_by = $2 WHERE id = $1', [t.id, CREATOR.id]);
    await svc.upsertStaff(pool, ADMIN, t.id, { userId: CREATOR.id, role: 'organizer' });
    await svc.upsertStaff(pool, ADMIN, t.id, { userId: ORG.id, role: 'organizer' });
    await svc.upsertStaff(pool, ADMIN, t.id, { userId: REF.id, role: 'referee' });
    const ms = await categorySvc.createCategory(pool, ADMIN, t.id, { code: 'MS', name: 'Đơn nam', isDoubles: false, groupCount: 1, advancePerGroup: 1 });
    await entrySvc.addEntries(pool, ADMIN, ms.id, [{ player1Name: 'An', player1StudentId: '22520001' }, { player1Name: 'Bình' }, { player1Name: 'Chi' }]);
    await svc.drawGroups(pool, ADMIN, ms.id);
    await courts.setCourtReferee(pool, ADMIN, t.id, 1, REF.id);
    return { t, ms };
  }

  test('chỉ quản trị viên hoặc người tạo được xoá; phải gõ đúng slug; không xoá giải đang diễn ra', async () => {
    const { t } = await fullTournament('xoa-quyen');
    await rejectsWith(svc.deleteTournament(pool, ORG, t.id, 'xoa-quyen'), 403);
    await rejectsWith(svc.deleteTournament(pool, REF, t.id, 'xoa-quyen'), 403);
    await rejectsWith(svc.deleteTournament(pool, CREATOR, t.id, 'sai-slug'), 422);
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'ongoing' });
    await rejectsWith(svc.deleteTournament(pool, CREATOR, t.id, 'xoa-quyen'), 409, 'TOURNAMENT_ONGOING');
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'published' });
    assert.equal((await svc.getTournament(pool, 'xoa-quyen', CREATOR)).canDelete, true);
    assert.equal((await svc.getTournament(pool, 'xoa-quyen', ORG)).canDelete, false);
    await svc.deleteTournament(pool, CREATOR, t.id, 'xoa-quyen');
  });

  test('giải đã xoá: biến khỏi danh sách / đường dẫn / hàng đợi trọng tài; không ai thao tác được', async () => {
    const { t, ms } = await fullTournament('da-xoa');
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'published' });
    assert.ok((await matchSvc.refereeQueue(pool, REF)).some((m) => m.tournamentId === t.id));
    // Trận đã gán sân 1 (REF phụ trách) → trước khi xoá, mọi đường nhập điểm đều mở được.
    const [first] = await matchSvc.listMatches(pool, t.id);
    await courts.moveMatch(pool, ADMIN, first.id, { court: 1 });
    const m = await matchSvc.getMatch(pool, first.id);
    await svc.deleteTournament(pool, ADMIN, t.id, 'da-xoa');
    await rejectsWith(svc.getTournament(pool, 'da-xoa', ADMIN), 404);
    assert.ok(!(await svc.listTournaments(pool, ADMIN)).some((x) => x.id === t.id));
    assert.ok(!(await svc.listTournaments(pool, null)).some((x) => x.id === t.id));
    await rejectsWith(svc.assertVisible(pool, t.id, ADMIN), 404);
    assert.ok(!(await matchSvc.refereeQueue(pool, REF)).some((m) => m.tournamentId === t.id));
    await rejectsWith(categorySvc.createCategory(pool, ADMIN, t.id, { code: 'WS', name: 'Đơn nữ', isDoubles: false }), 403);
    await rejectsWith(svc.updateTournament(pool, CREATOR, t.id, { name: 'Sửa sau khi xoá' }), 403);
    await rejectsWith(svc.drawGroups(pool, ADMIN, ms.id), 403);
    // Nhập điểm (lockScorable) cũng bị khoá — cả trọng tài sân lẫn quản trị viên; giải không bị đổi sang "đang diễn ra".
    for (const who of [REF, ADMIN]) {
      await rejectsWith(matchSvc.startMatch(pool, who, m.id, { version: m.version }), 403);
      await rejectsWith(rallies.addRally(pool, who, m.id, { type: 'start', server: 'a1', receiver: 'b1', expectedSeq: 1 }), 403);
      await rejectsWith(matchSvc.recordScore(pool, who, m.id, { action: 'save', version: m.version, games: [[1, 0]] }), 403);
    }
    const after = (await pool.query('SELECT status FROM tournaments WHERE id = $1', [t.id])).rows[0];
    assert.equal(after.status, 'published', 'deleted tournament must not flip to ongoing');
  });

  test('khôi phục trong 7 ngày; danh sách giải đã xoá chỉ cho quản trị viên / người tạo', async () => {
    const { t } = await fullTournament('khoi-phuc');
    await svc.deleteTournament(pool, CREATOR, t.id, 'khoi-phuc');
    assert.ok((await svc.listDeletedTournaments(pool, CREATOR)).some((x) => x.id === t.id));
    assert.ok((await svc.listDeletedTournaments(pool, ADMIN)).some((x) => x.id === t.id));
    assert.ok(!(await svc.listDeletedTournaments(pool, ORG)).some((x) => x.id === t.id));
    await rejectsWith(svc.restoreTournament(pool, ORG, t.id), 403);
    await svc.restoreTournament(pool, CREATOR, t.id);
    assert.equal((await svc.getTournament(pool, 'khoi-phuc', ADMIN)).id, t.id);
    // Quá 7 ngày: không khôi phục được.
    await svc.deleteTournament(pool, CREATOR, t.id, 'khoi-phuc');
    await pool.query("UPDATE tournaments SET deleted_at = now() - interval '8 days' WHERE id = $1", [t.id]);
    await rejectsWith(svc.restoreTournament(pool, ADMIN, t.id), 409, 'RESTORE_EXPIRED');
    assert.ok(!(await svc.listDeletedTournaments(pool, ADMIN)).some((x) => x.id === t.id));
  });

  test('quá 7 ngày → xoá hẳn dây chuyền: nội dung, đội, VĐV, trận, nhật ký, phân công trọng tài', async () => {
    const { t } = await fullTournament('xoa-han');
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'published' });
    await svc.deleteTournament(pool, ADMIN, t.id, 'xoa-han');
    await svc.purgeDeletedTournaments(pool);
    const kept = await pool.query('SELECT count(*)::int AS n FROM tournaments WHERE id = $1', [t.id]);
    assert.equal(kept.rows[0].n, 1, 'chưa đủ 7 ngày thì chưa xoá hẳn');
    await pool.query("UPDATE tournaments SET deleted_at = now() - interval '8 days' WHERE id = $1", [t.id]);
    assert.ok((await svc.purgeDeletedTournaments(pool)) >= 1);
    for (const table of ['categories', 'matches', 'athletes', 'tournament_events', 'tournament_staff', 'court_referees']) {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE tournament_id = $1`, [t.id]);
      assert.equal(rows[0].n, 0, table);
    }
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM tournaments WHERE id = $1', [t.id]);
    assert.equal(rows[0].n, 0);
  });

  test('sửa thông tin giải: đổi slug, trùng slug báo SLUG_TAKEN; chỉ BTC', async () => {
    const { t } = await fullTournament('sua-thong-tin');
    await svc.createTournament(pool, ADMIN, { slug: 'da-co', name: 'Giải đã có', startsAt: future(9) });
    await rejectsWith(svc.updateTournament(pool, ORG, t.id, { slug: 'da-co' }), 409, 'SLUG_TAKEN');
    const u = await svc.updateTournament(pool, ORG, t.id, { slug: 'slug-moi', name: 'Tên mới', courts: 6, slotMinutes: 20, venue: 'Nhà thi đấu' });
    assert.equal(u.slug, 'slug-moi');
    assert.equal(u.courts, 6);
    assert.equal((await svc.getTournament(pool, 'slug-moi', ORG)).name, 'Tên mới');
    await rejectsWith(svc.updateTournament(pool, REF, t.id, { name: 'Trọng tài sửa' }), 403);
  });
});
