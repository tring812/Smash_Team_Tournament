'use strict';
/**
 * Route matches: Trận: xem, bắt đầu, nhập điểm, biên bản, mở lại, phân công trọng tài; điều phối sân; hàng đợi trọng tài; tìm tài khoản.
 * Gắn thẳng vào router `/api` của app.js (cùng thứ tự, cùng middleware) — chỉ tách file, không đổi hành vi.
 */
const svc = require('../services/tournamentService');
const matchSvc = require('../services/matchService');
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
    const { rallies: withLog } = schemas.matchView.parse(req.query);
    const m = await matchSvc.getMatch(pool, id(req.params.id));
    await svc.assertVisible(pool, m.tournamentId, me(req));
    res.json(withLog === '0' ? m : { ...m, rallies: await rallies.listRallies(pool, m.id) });
  });
  // ── Biên bản diễn biến điểm ──
  /** @param {boolean} [onlyThisMatch] true = chỉ tỉ số / biên bản trận này đổi (mỗi điểm); false = thay đổi cấu trúc */
  const withRallies = async (res, mid, onlyThisMatch = true) => {
    const m = await matchSvc.getMatch(pool, mid);
    touch(res, m.tournamentId, onlyThisMatch ? mid : undefined);
    res.json({ ...m, rallies: await rallies.listRallies(pool, mid) });
  };
  api.post('/matches/:id/start', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    const started = await matchSvc.startMatch(pool, me(req), mid, schemas.startMatch.parse(req.body));
    // Chỉ trận này đổi — trừ trận ĐẦU TIÊN của giải (giải chuyển sang "đang diễn ra") → tải lại toàn bộ.
    await withRallies(res, mid, !started.tournament_started);
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
    const out = await matchSvc.recordScore(pool, me(req), mid, body);
    log('info', 'score_recorded', { request_id: req.id, match_id: mid, action: body.action, user_id: me(req).id });
    const m = await matchSvc.getMatch(pool, mid);
    // Lưu tạm: chỉ trận này. Xác nhận / bỏ cuộc: trận này + các trận được đưa đội thắng vào, và bảng xếp hạng / nhánh
    // của nội dung → màn hình tải riêng các phần đó thay vì cả lịch. Giải vừa chuyển "đang diễn ra" → toàn bộ.
    if (out.tournament_started) touch(res, m.tournamentId);
    else if (body.action === 'save') touch(res, m.tournamentId, mid);
    else touch(res, m.tournamentId, out.changed_match_ids, m.category.id);
    res.json(m);
  });
  api.post('/matches/:id/reopen', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await matchSvc.reopenMatch(pool, me(req), mid);
    const m = await matchSvc.getMatch(pool, mid);
    touch(res, m.tournamentId);
    res.json(m);
  });
  api.put('/matches/:id/referee', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await matchSvc.assignReferee(pool, me(req), mid, schemas.referee.parse(req.body).refereeUserId);
    const m = await matchSvc.getMatch(pool, mid);
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
    const m = await matchSvc.getMatch(pool, mid);
    touch(res, m.tournamentId, mid); // chỉ trận này đổi sân / trạng thái gọi
    res.json(m);
  });
  api.post('/matches/:id/uncall', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await courts.uncallMatch(pool, me(req), mid);
    const m = await matchSvc.getMatch(pool, mid);
    touch(res, m.tournamentId, mid); // chỉ trận này đổi sân / trạng thái gọi
    res.json(m);
  });
  api.patch('/matches/:id', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await courts.moveMatch(pool, me(req), mid, schemas.moveMatch.parse(req.body));
    const m = await matchSvc.getMatch(pool, mid);
    touch(res, m.tournamentId, mid); // chỉ trận này đổi giờ / sân
    res.json(m);
  });
  api.get('/referee/queue', auth.requireAuth, async (req, res) => res.json(await matchSvc.refereeQueue(pool, me(req))));
  api.get('/users', auth.requireAuth, async (req, res) => {
    res.json(await svc.searchUsers(pool, me(req), schemas.userSearch.parse(req.query).q));
  });
};
