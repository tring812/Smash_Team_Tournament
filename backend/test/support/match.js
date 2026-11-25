'use strict';
const matchSvc = require('../../src/services/matchService');
const courts = require('../../src/services/courtService');

/** Chuẩn bị trận live cho test nghiệp vụ qua API bắt đầu tương thích cũ. */
async function beginMatch(pool, organizer, viewer, match) {
  let fresh = await matchSvc.getMatch(pool, match.id);
  if (fresh.status === 'live') return fresh;
  if (!fresh.court) {
    await courts.moveMatch(pool, organizer, fresh.id, { court: 1 });
    fresh = await matchSvc.getMatch(pool, fresh.id);
  }
  await matchSvc.startMatch(pool, viewer, fresh.id, { version: fresh.version });
  return matchSvc.getMatch(pool, fresh.id);
}

module.exports = { beginMatch };
