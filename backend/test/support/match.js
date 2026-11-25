'use strict';
const matchSvc = require('../../src/services/matchService');
const courts = require('../../src/services/courtService');

/** Thực hiện đúng bước BTC gán sân → trọng tài bắt đầu trước khi test nghiệp vụ ghi điểm. */
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
