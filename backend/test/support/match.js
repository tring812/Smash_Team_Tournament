'use strict';
const svc = require('../../src/services/tournamentService');
const courts = require('../../src/services/courtService');

/** Chuẩn bị trận live cho test nghiệp vụ qua API bắt đầu tương thích cũ. */
async function beginMatch(pool, organizer, viewer, match) {
  let fresh = await svc.getMatch(pool, match.id);
  if (fresh.status === 'live') return fresh;
  if (!fresh.court) {
    await courts.moveMatch(pool, organizer, fresh.id, { court: 1 });
    fresh = await svc.getMatch(pool, fresh.id);
  }
  await svc.startMatch(pool, viewer, fresh.id, { version: fresh.version });
  return svc.getMatch(pool, fresh.id);
}

module.exports = { beginMatch };
