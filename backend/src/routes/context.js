'use strict';
/**
 * Kiểu dùng chung cho các file route (chỉ JSDoc, không có mã chạy).
 *
 * @typedef {object} RouteContext
 * @property {import('../services/tournamentService').Pool} pool
 * @property {import('../config').AppConfig} config
 * @property {(v: unknown) => string} id  kiểm tra + trả UUID từ tham số đường dẫn (422 nếu sai)
 * @property {(req: import('express').Request) => any} me  người đang đăng nhập (`req.viewer`) hoặc null
 * @property {(res: import('express').Response, tid: string|undefined, matchIds?: string|string[], categoryId?: string) => void} touch
 *   đánh dấu giải vừa đổi để báo qua kênh trực tiếp sau khi trả 2xx (có `matchIds` = chỉ các trận đó đổi;
 *   thêm `categoryId` = bảng xếp hạng / nhánh của nội dung đó đổi theo)
 * @property {(res: import('express').Response, categoryId: string) => Promise<void>} touchCategory
 * @property {(res: import('express').Response, entryId: string) => Promise<void>} touchEntry
 */

module.exports = {};
