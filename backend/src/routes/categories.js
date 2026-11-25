'use strict';
/**
 * Route categories: Nội dung thi đấu và đội: sửa, luật điểm theo vòng, thêm / sửa / truất quyền đội, bốc thăm, loại trực tiếp; đọc bảng / nhánh.
 * Gắn thẳng vào router `/api` của app.js (cùng thứ tự, cùng middleware) — chỉ tách file, không đổi hành vi.
 */
const svc = require('../services/tournamentService');
const auth = require('../auth');
const { schemas } = require('../schemas');

/**
 * @param {import('express').Router} api @param {import('./context').RouteContext} ctx
 */
module.exports = function registerCategoriesRoutes(api, { pool, id, me, touchCategory, touchEntry }) {
  // ── Nội dung ──
  const visibleCategory = async (req) => {
    const cid = id(req.params.id);
    await svc.assertCategoryVisible(pool, cid, me(req));
    return cid;
  };
  api.patch('/categories/:id', auth.requireAuth, async (req, res) => {
    res.json(await svc.updateCategory(pool, me(req), id(req.params.id), schemas.updateCategory.parse(req.body)));
  });
  api.put('/categories/:id/round-rules', auth.requireAuth, async (req, res) => {
    const { rules } = schemas.roundRules.parse(req.body);
    await touchCategory(res, id(req.params.id));
    res.json(await svc.setRoundRules(pool, me(req), id(req.params.id), rules));
  });
  api.delete('/categories/:id', auth.requireAuth, async (req, res) => {
    await svc.deleteCategory(pool, me(req), id(req.params.id));
    res.status(204).end();
  });
  api.get('/categories/:id/entries', async (req, res) => res.json(await svc.listEntries(pool, await visibleCategory(req))));
  api.get('/categories/:id/standings', async (req, res) => res.json(await svc.groupStandings(pool, await visibleCategory(req))));
  api.get('/categories/:id/bracket', async (req, res) => res.json(await svc.getBracket(pool, await visibleCategory(req))));
  api.post('/categories/:id/entries', auth.requireAuth, async (req, res) => {
    const { entries } = schemas.addEntries.parse(req.body);
    await touchCategory(res, id(req.params.id));
    res.status(201).json(await svc.addEntries(pool, me(req), id(req.params.id), entries));
  });
  api.patch('/entries/:id', auth.requireAuth, async (req, res) => {
    await touchEntry(res, id(req.params.id));
    res.json(await svc.updateEntry(pool, me(req), id(req.params.id), schemas.updateEntry.parse(req.body)));
  });
  api.post('/entries/:id/disqualify', auth.requireAuth, async (req, res) => {
    await touchEntry(res, id(req.params.id));
    res.json(await svc.disqualifyEntry(pool, me(req), id(req.params.id), schemas.disqualify.parse(req.body).reason));
  });
  api.post('/entries/:id/reinstate', auth.requireAuth, async (req, res) => {
    await touchEntry(res, id(req.params.id));
    res.json(await svc.reinstateEntry(pool, me(req), id(req.params.id)));
  });
  api.post('/categories/:id/swap', auth.requireAuth, async (req, res) => {
    const { entryA, entryB } = schemas.swap.parse(req.body);
    await touchCategory(res, id(req.params.id));
    res.json(await svc.swapEntries(pool, me(req), id(req.params.id), entryA, entryB));
  });
  api.delete('/entries/:id', auth.requireAuth, async (req, res) => {
    await svc.removeEntry(pool, me(req), id(req.params.id));
    res.status(204).end();
  });
  api.post('/categories/:id/draw', auth.requireAuth, async (req, res) => {
    const { groups } = schemas.draw.parse(req.body ?? {});
    await touchCategory(res, id(req.params.id));
    res.json(await svc.drawGroups(pool, me(req), id(req.params.id), groups ? { manual: groups } : {}));
  });
  api.post('/categories/:id/knockout', auth.requireAuth, async (req, res) => {
    await touchCategory(res, id(req.params.id));
    res.json(await svc.generateKnockout(pool, me(req), id(req.params.id)));
  });
};
