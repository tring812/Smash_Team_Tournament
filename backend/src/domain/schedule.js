'use strict';
/**
 * Xếp lịch sân — tham lam (greedy), tất định.
 *
 * Ràng buộc cứng:
 *  - một người không đánh 2 trận cùng khung giờ (kể cả khác nội dung);
 *  - trận có `after` (nhánh loại trực tiếp) chỉ bắt đầu khi mọi trận dẫn vào đã xếp xong
 *    và cách ít nhất `gap` khung (mặc định 2 = nghỉ 1 khung);
 *  - `blocked`: sân/người đang bận (trận đang đánh) không dùng được ở khung đầu tiên.
 * Ràng buộc mềm: cố gắng cho nghỉ 1 khung giữa hai trận liên tiếp.
 */

/**
 * @typedef {Object} SchedulableMatch
 * @property {string} id
 * @property {string[]} participants  khoá người chơi (user id hoặc tên chuẩn hoá); trống nếu chưa biết đội
 * @property {number} priority        nhỏ hơn = xếp trước
 * @property {string[]} [after]       id các trận phải xong trước (trận dẫn vào trong nhánh)
 */
/** @typedef {{ id: string, slot: number, court: number, startsAt: Date }} ScheduledSlot */

/**
 * @param {SchedulableMatch[]} matches
 * @param {{ courts: number, startAt: Date, slotMinutes: number, gap?: number,
 *           blocked?: { courts?: number[], participants?: string[] } }} opts
 * @returns {ScheduledSlot[]}
 */
function scheduleMatches(matches, opts) {
  const { courts, startAt, slotMinutes } = opts;
  const gap = opts.gap ?? 2;
  if (!Number.isInteger(courts) || courts < 1 || courts > 50) throw new RangeError('courts phải 1..50');
  if (!Number.isInteger(slotMinutes) || slotMinutes < 5 || slotMinutes > 240) {
    throw new RangeError('slotMinutes phải 5..240');
  }
  const ids = new Set(matches.map((m) => m.id));
  const pending = [...matches].sort((x, y) => x.priority - y.priority || (x.id < y.id ? -1 : 1));
  /** @type {Map<string, number>} */
  const slotOf = new Map();
  /** @type {ScheduledSlot[]} */
  const out = [];
  /** @type {Set<string>} */
  let prevBusy = new Set();
  let slot = 0;
  const maxSlots = matches.length * (gap + 1) + 2; // chặn vòng lặp vô hạn với dữ liệu bệnh lý

  /** @param {SchedulableMatch} m */
  const ready = (m) => (m.after ?? []).every((d) => !ids.has(d) || (slotOf.has(d) && slot - /** @type {number} */ (slotOf.get(d)) >= gap));

  while (pending.length > 0 && slot <= maxSlots) {
    const busy = new Set(slot === 0 ? opts.blocked?.participants ?? [] : []);
    const freeCourts = Array.from({ length: courts }, (_, i) => i + 1)
      .filter((c) => slot !== 0 || !(opts.blocked?.courts ?? []).includes(c));
    let used = 0;
    for (const strict of [true, false]) {
      for (let i = 0; i < pending.length && used < freeCourts.length; ) {
        const m = pending[i];
        const clash = m.participants.some((p) => busy.has(p));
        const tired = strict && m.participants.some((p) => prevBusy.has(p));
        if (!clash && !tired && ready(m)) {
          const court = freeCourts[used];
          used += 1;
          m.participants.forEach((p) => busy.add(p));
          slotOf.set(m.id, slot);
          out.push({ id: m.id, slot, court, startsAt: new Date(startAt.getTime() + slot * slotMinutes * 60_000) });
          pending.splice(i, 1);
        } else {
          i += 1;
        }
      }
    }
    prevBusy = busy;
    slot += 1;
  }
  return out;
}

module.exports = { scheduleMatches };
