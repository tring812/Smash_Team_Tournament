'use strict';

/** Lỗi nghiệp vụ mang HTTP status + mã máy đọc được; message an toàn để trả cho client. */
class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const notFound = (what = 'Không tìm thấy') => new HttpError(404, 'NOT_FOUND', what);
const forbidden = (msg = 'Bạn không có quyền thực hiện thao tác này') => new HttpError(403, 'FORBIDDEN', msg);
const conflict = (code, msg, details) => new HttpError(409, code, msg, details);
const unprocessable = (msg, details) => new HttpError(422, 'VALIDATION_FAILED', msg, details);

module.exports = { HttpError, notFound, forbidden, conflict, unprocessable };
