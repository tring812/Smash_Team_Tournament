'use strict';
const svc = require('../../src/services/tournamentService');
const courts = require('../../src/services/courtService');

/** Thực hiện đúng bước BTC gán sân → trọng tài bắt đầu trước khi test nghiệp vụ ghi điểm. */
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
