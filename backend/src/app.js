'use strict';
/**
 * Express app (không listen) — tách khỏi server.js để test bằng HTTP mà không mở cổng thật.
 */
const crypto = require('node:crypto');
const express = require('express');
const { ZodError } = require('zod');

const svc = require('./services/tournamentService');
const live = require('./liveBus');
const auth = require('./auth');
const { schemas } = require('./schemas');
const { HttpError } = require('./errors');
const { log } = require('./log');
const registerAuthRoutes = require('./routes/auth');
const registerTournamentsRoutes = require('./routes/tournaments');
const registerCategoriesRoutes = require('./routes/categories');
const registerMatchesRoutes = require('./routes/matches');

/**
 * @param {{ pool: import('./services/tournamentService').Pool, config: import('./config').AppConfig }} deps
 */
function createApp({ pool, config }) {
  const app = express();
  app.set('trust proxy', 1); // sau 1 reverse proxy (Render/Vercel)
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      log('info', 'http_request', {
        request_id: req.id, method: req.method, path: req.route?.path ?? req.path, status: res.statusCode,
        duration_ms: Number(process.hrtime.bigint() - t0) / 1e6, user_id: req.viewer?.id ?? null,
      });
    });
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/readyz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  const api = express.Router();
  api.use(auth.csrfGuard(config.publicOrigin));
  api.use(auth.loadViewer(pool, config));

  const id = (v) => schemas.uuidParam.parse(v);
  const me = (req) => req.viewer;

  // Realtime: route ghi đặt res.locals.tid → sau khi trả 2xx, báo các màn hình đang xem giải đó tải lại.
  api.use((req, res, next) => {
    if (req.method !== 'GET') {
      res.on('finish', () => { if (res.statusCode < 400 && res.locals.tid) live.publish(res.locals.tid, res.locals.liveScope); });
    }
    next();
  });
  /**
   * @param {string} [matchId] chỉ tỉ số / biên bản / trọng tài của MỘT trận đổi → màn hình chỉ tải lại trận đó
   *   thay vì cả lịch + bảng xếp hạng (xem liveBus). Bỏ trống = thay đổi cấu trúc, tải lại toàn bộ.
   */
  const touch = (res, tid, matchId) => {
    res.locals.tid = tid;
    res.locals.liveScope = matchId ? { kind: 'match', matchId } : { kind: 'structure' };
  };
  const touchCategory = async (res, cid) => touch(res, await svc.tournamentOfCategory(pool, cid));
  const touchEntry = async (res, eid) => {
    const r = await pool.query('SELECT c.tournament_id FROM entries e JOIN categories c ON c.id = e.category_id WHERE e.id = $1', [eid]);
    touch(res, r.rows[0]?.tournament_id);
  };

  // Route theo vùng (src/routes/*), gắn theo đúng thứ tự cũ trên cùng router này.
  /** @type {import('./routes/context').RouteContext} */
  const ctx = { pool, config, id, me, touch, touchCategory, touchEntry };
  registerAuthRoutes(api, ctx);
  registerTournamentsRoutes(api, ctx);
  registerCategoriesRoutes(api, ctx);
  registerMatchesRoutes(api, ctx);

  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'API không tồn tại')));

  // Lỗi → RFC 7807 problem+json. Không lộ stack/SQL ra client; log chi tiết ở server.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof ZodError) {
      return res.status(422).type('application/problem+json').json({
        type: 'about:blank', title: 'Dữ liệu không hợp lệ', status: 422, code: 'VALIDATION_FAILED',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).type('application/problem+json').json({
        type: 'about:blank', title: err.message, status: err.status, code: err.code, ...(err.details ?? {}),
      });
    }
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      return res.status(400).type('application/problem+json').json({ type: 'about:blank', title: 'Body không hợp lệ', status: 400, code: 'BAD_BODY' });
    }
    log('error', 'unhandled_error', { request_id: req.id, error: err?.message, code: err?.code, stack: err?.stack });
    return res.status(500).type('application/problem+json').json({
      type: 'about:blank', title: 'Lỗi hệ thống', status: 500, code: 'INTERNAL', request_id: req.id,
    });
  });
  return app;
}

module.exports = { createApp };
