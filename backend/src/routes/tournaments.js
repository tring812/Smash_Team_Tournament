'use strict';
/**
 * Route tournaments: Giải: tạo / sửa / xoá / khôi phục, BTC, tài khoản trọng tài, xếp lịch, nhật ký, kênh trực tiếp, hồ sơ VĐV, danh sách trận.
 * Gắn thẳng vào router `/api` của app.js (cùng thứ tự, cùng middleware) — chỉ tách file, không đổi hành vi.
 */
const svc = require('../services/tournamentService');
const categorySvc = require('../services/categoryService');
const matchSvc = require('../services/matchService');
const athletes = require('../services/athleteService');
const entries = require('../services/entryService');
const referees = require('../services/refereeService');
const live = require('../liveBus');
const auth = require('../auth');
const { schemas } = require('../schemas');
const { HttpError } = require('../errors');
const { log } = require('../log');

/**
 * @param {import('express').Router} api @param {import('./context').RouteContext} ctx
 */
module.exports = function registerTournamentsRoutes(api, { pool, id, me, touch }) {
  // ── Giải ──
  api.get('/tournaments', async (req, res) => res.json(await svc.listTournaments(pool, me(req))));
  api.post('/tournaments', auth.requireAuth, async (req, res) => {
    res.status(201).json(await svc.createTournament(pool, me(req), schemas.createTournament.parse(req.body)));
  });
  // Giải đã xoá còn khôi phục được.
  api.get('/deleted-tournaments', auth.requireAuth, async (req, res) => {
    res.json(await svc.listDeletedTournaments(pool, me(req)));
  });
  api.delete('/tournaments/:id', auth.requireAuth, async (req, res) => {
    const out = await svc.deleteTournament(pool, me(req), id(req.params.id), schemas.deleteTournament.parse(req.body ?? {}).confirmSlug);
    touch(res, out.id);
    res.json(out);
  });
  api.post('/tournaments/:id/restore', auth.requireAuth, async (req, res) => {
    res.json(await svc.restoreTournament(pool, me(req), id(req.params.id)));
  });
  api.get('/tournaments/:slug', async (req, res) => {
    const slug = String(req.params.slug).slice(0, 80);
    res.json(await svc.getTournament(pool, slug, me(req)));
  });
  api.patch('/tournaments/:id', auth.requireAuth, async (req, res) => {
    touch(res, req.params.id);
    res.json(await svc.updateTournament(pool, me(req), id(req.params.id), schemas.updateTournament.parse(req.body)));
  });
  api.get('/tournaments/:id/staff', auth.requireAuth, async (req, res) => {
    res.json(await svc.listStaff(pool, me(req), id(req.params.id)));
  });
  api.put('/tournaments/:id/staff/:userId', auth.requireAuth, async (req, res) => {
    const { role } = schemas.staff.parse(req.body);
    res.json(await svc.upsertStaff(pool, me(req), id(req.params.id), { userId: id(req.params.userId), role }));
  });
  api.delete('/tournaments/:id/staff/:userId', auth.requireAuth, async (req, res) => {
    await svc.removeStaff(pool, me(req), id(req.params.id), id(req.params.userId));
    res.status(204).end();
  });
  // ── Tài khoản trọng tài của giải (BTC tự quản lý, xem refereeService) ──
  api.get('/tournaments/:id/referees', auth.requireAuth, async (req, res) => {
    res.json(await referees.listReferees(pool, me(req), id(req.params.id)));
  });
  api.post('/tournaments/:id/referees', auth.requireAuth, async (req, res) => {
    const u = await referees.createReferee(pool, me(req), id(req.params.id), schemas.createReferee.parse(req.body));
    log('info', 'referee_created', { request_id: req.id, user_id: u.id, by: me(req).id, tournament_id: req.params.id });
    res.status(201).json(u);
  });
  api.patch('/tournaments/:id/referees/:userId', auth.requireAuth, async (req, res) => {
    const patch = schemas.updateReferee.parse(req.body);
    const u = await referees.updateReferee(pool, me(req), id(req.params.id), id(req.params.userId), patch);
    log('info', 'referee_updated', { request_id: req.id, user_id: u.id, by: me(req).id, fields: Object.keys(patch) });
    res.json(u);
  });
  api.delete('/tournaments/:id/referees/:userId', auth.requireAuth, async (req, res) => {
    res.json(await referees.removeReferee(pool, me(req), id(req.params.id), id(req.params.userId)));
  });
  api.post('/tournaments/:id/categories', auth.requireAuth, async (req, res) => {
    res.status(201).json(await categorySvc.createCategory(pool, me(req), id(req.params.id), schemas.createCategory.parse(req.body)));
  });
  api.post('/tournaments/:id/schedule', auth.requireAuth, async (req, res) => {
    touch(res, req.params.id);
    res.json(await svc.scheduleTournament(pool, me(req), id(req.params.id), schemas.schedule.parse(req.body ?? {})));
  });
  api.get('/tournaments/:id/events', auth.requireAuth, async (req, res) => {
    res.json(await svc.listEvents(pool, me(req), id(req.params.id)));
  });
  // Server-Sent Events: "giải vừa đổi" → client gọi lại API. Quyền xem như danh sách trận.
  api.get('/tournaments/:id/stream', async (req, res) => {
    const tid = id(req.params.id);
    await svc.assertVisible(pool, tid, me(req));
    if (!live.subscribe(req, res, tid)) throw new HttpError(503, 'TOO_MANY_STREAMS', 'Quá nhiều kết nối trực tiếp, đang dùng chế độ tự làm mới');
  });
  // Hồ sơ VĐV (MSSV/SĐT — chỉ BTC).
  api.get('/tournaments/:id/athletes', auth.requireAuth, async (req, res) => {
    res.json(await athletes.listAthletes(pool, me(req), id(req.params.id)));
  });
  api.patch('/athletes/:id', auth.requireAuth, async (req, res) => {
    const out = await athletes.updateAthlete(pool, me(req), id(req.params.id), schemas.updateAthlete.parse(req.body));
    const r = await pool.query('SELECT tournament_id FROM athletes WHERE id = $1', [out.id]);
    touch(res, r.rows[0]?.tournament_id);
    res.json(out);
  });
  api.post('/athletes/:id/disqualify', auth.requireAuth, async (req, res) => {
    const out = await entries.disqualifyAthlete(pool, me(req), id(req.params.id), schemas.disqualifyAthlete.parse(req.body));
    touch(res, out.tournamentId);
    res.json(out);
  });
  // BXH mọi nội dung của giải trong MỘT request (trang giải: tab Bảng đấu / tìm VĐV) thay cho 1 request mỗi nội dung.
  api.get('/tournaments/:id/standings', async (req, res) => {
    const tid = id(req.params.id);
    await svc.assertVisible(pool, tid, me(req));
    res.json(await svc.tournamentStandings(pool, tid));
  });
  api.get('/tournaments/:id/matches', async (req, res) => {
    const tid = id(req.params.id);
    await svc.assertVisible(pool, tid, me(req));
    res.json(await matchSvc.listMatches(pool, tid, schemas.matchFilter.parse(req.query)));
  });
};
