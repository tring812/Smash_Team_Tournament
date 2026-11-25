'use strict';
/**
 * Route matches: Trận: xem, bắt đầu, nhập điểm, biên bản, mở lại, phân công trọng tài; điều phối sân; hàng đợi trọng tài; tìm tài khoản.
 * Gắn thẳng vào router `/api` của app.js (cùng thứ tự, cùng middleware) — chỉ tách file, không đổi hành vi.
 */
const svc = require('../services/tournamentService');
const courts = require('../services/courtService');
const rallies = require('../services/rallyService');
const auth = require('../auth');
const { schemas } = require('../schemas');
const { log } = require('../log');

/**
 * @param {import('express').Router} api @param {import('./context').RouteContext} ctx
 */
module.exports = function registerMatchesRoutes(api, { pool, id, me, touch }) {
  // ── Trận & trọng tài ──
  api.get('/matches/:id', async (req, res) => {
    const m = await svc.getMatch(pool, id(req.params.id));
    await svc.assertVisible(pool, m.tournamentId, me(req));
    res.json({ ...m, rallies: await rallies.listRallies(pool, m.id) });
  });
  // ── Biên bản diễn biến điểm ──
  /** @param {boolean} [onlyThisMatch] true = chỉ tỉ số / biên bản trận này đổi (mỗi điểm); false = thay đổi cấu trúc */
  const withRallies = async (res, mid, onlyThisMatch = true) => {
    const m = await svc.getMatch(pool, mid);
    touch(res, m.tournamentId, onlyThisMatch ? mid : undefined);
    res.json({ ...m, rallies: await rallies.listRallies(pool, mid) });
  };
  api.post('/matches/:id/start', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await svc.startMatch(pool, me(req), mid, schemas.startMatch.parse(req.body));
    // Bắt đầu trận (mỗi trận một lần) có thể chuyển giải sang "đang diễn ra" → tải lại toàn bộ.
    await withRallies(res, mid, false);
  });
  api.post('/matches/:id/rallies', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await rallies.addRally(pool, me(req), mid, schemas.rally.parse(req.body));
    await withRallies(res, mid);
  });
  api.delete('/matches/:id/rallies/last', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await rallies.undoRally(pool, me(req), mid, schemas.rallyUndo.parse(req.query).expectedSeq);
    await withRallies(res, mid);
  });
  api.put('/matches/:id/score', auth.requireAuth, async (req, res) => {
    const body = schemas.score.parse(req.body);
    const mid = id(req.params.id);
    await svc.recordScore(pool, me(req), mid, body);
    log('info', 'score_recorded', { request_id: req.id, match_id: mid, action: body.action, user_id: me(req).id });
    const m = await svc.getMatch(pool, mid);
    // Lưu tạm chỉ đổi trận này; xác nhận / bỏ cuộc còn đưa đội thắng sang trận sau và đổi bảng xếp hạng.
    touch(res, m.tournamentId, body.action === 'save' ? mid : undefined);
    res.json(m);
  });
  api.post('/matches/:id/reopen', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await svc.reopenMatch(pool, me(req), mid);
    const m = await svc.getMatch(pool, mid);
    touch(res, m.tournamentId);
    res.json(m);
  });
  api.put('/matches/:id/referee', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await svc.assignReferee(pool, me(req), mid, schemas.referee.parse(req.body).refereeUserId);
    const m = await svc.getMatch(pool, mid);
    touch(res, m.tournamentId, mid);
    res.json(m);
  });
  // ── Điều phối sân ──
  api.get('/tournaments/:id/courts', auth.requireAuth, async (req, res) => {
    res.json(await courts.courtBoard(pool, me(req), id(req.params.id)));
  });
  api.put('/tournaments/:id/courts/:court/referee', auth.requireAuth, async (req, res) => {
    const court = schemas.courtParam.parse(req.params.court);
    touch(res, req.params.id);
    res.json(await courts.setCourtReferee(pool, me(req), id(req.params.id), court, schemas.referee.parse(req.body).refereeUserId));
  });
  api.post('/matches/:id/call', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await courts.callMatch(pool, me(req), mid, schemas.callMatch.parse(req.body));
    const m = await svc.getMatch(pool, mid);
    touch(res, m.tournamentId);
    res.json(m);
  });
  api.post('/matches/:id/uncall', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await courts.uncallMatch(pool, me(req), mid);
    const m = await svc.getMatch(pool, mid);
    touch(res, m.tournamentId);
    res.json(m);
  });
  api.patch('/matches/:id', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await courts.moveMatch(pool, me(req), mid, schemas.moveMatch.parse(req.body));
    const m = await svc.getMatch(pool, mid);
    touch(res, m.tournamentId);
    res.json(m);
  });
  api.get('/referee/queue', auth.requireAuth, async (req, res) => res.json(await svc.refereeQueue(pool, me(req))));
  api.get('/users', auth.requireAuth, async (req, res) => {
    res.json(await svc.searchUsers(pool, me(req), schemas.userSearch.parse(req.query).q));
  });
};
