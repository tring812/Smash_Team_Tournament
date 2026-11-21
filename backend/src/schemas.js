'use strict';
/** Schema zod cho mọi body/query tại biên HTTP (zod v4). */
const { z } = require('zod');

const name = (max) => z.string().trim().min(1).max(max);
const score = z.number().int().min(0).max(60);
const password = z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(128);
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Tên đăng nhập 3–40 ký tự: chữ thường, số, . _ -');

const schemas = {
  login: z.object({
    username: z.string().trim().min(1).max(40),
    password: z.string().min(1).max(128),
  }),
  createUser: z.object({
    username,
    fullName: name(255),
    password,
    role: z.enum(['admin', 'user']).default('user'),
  }),
  updateUser: z.object({
    username: username.optional(), // chỉ đặt được cho tài khoản CHƯA có (user từ bản SSO cũ)
    fullName: name(255).optional(),
    role: z.enum(['admin', 'user']).optional(),
    password: password.optional(),
    disabled: z.boolean().optional(),
  }).refine((o) => Object.values(o).some((v) => v !== undefined), { message: 'Không có gì để cập nhật' }),
  // Tài khoản trọng tài do BTC tạo trong trang quản trị giải (luôn là tài khoản thường).
  createReferee: z.object({ username, fullName: name(255), password }),
  updateReferee: z.object({
    fullName: name(255).optional(),
    password: password.optional(),
    disabled: z.boolean().optional(),
  }).refine((o) => Object.values(o).some((v) => v !== undefined), { message: 'Không có gì để cập nhật' }),
  changePassword: z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }),
  uuidParam: z.uuid(),

  createTournament: z.object({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80),
    name: name(200).min(3),
    venue: z.string().trim().max(200).optional(),
    startsAt: z.iso.datetime({ offset: true }),
    courts: z.number().int().min(1).max(50).optional(),
    slotMinutes: z.number().int().min(5).max(240).optional(),
  }),
  updateTournament: z.object({
    name: name(200).min(3).optional(),
    venue: z.string().trim().max(200).optional(),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    courts: z.number().int().min(1).max(50).optional(),
    slotMinutes: z.number().int().min(5).max(240).optional(),
    status: z.enum(['draft', 'published', 'ongoing', 'completed']).optional(),
  }),
  staff: z.object({ role: z.enum(['organizer', 'referee']) }),

  createCategory: z.object({
    code: z.string().regex(/^[A-Z0-9]{1,10}$/),
    name: name(100),
    isDoubles: z.boolean(),
    groupCount: z.number().int().min(1).max(32).optional(),
    advancePerGroup: z.number().int().min(1).max(4).optional(),
    pointsToWin: z.number().int().min(5).max(50).optional(),
    maxPoints: z.number().int().min(5).max(60).optional(),
    gamesToWin: z.number().int().min(1).max(3).optional(),
  }),
  updateCategory: z.object({
    code: z.string().regex(/^[A-Z0-9]{1,10}$/).optional(),
    name: name(100).optional(),
    isDoubles: z.boolean().optional(),
    groupCount: z.number().int().min(1).max(32).optional(),
    advancePerGroup: z.number().int().min(1).max(4).optional(),
    pointsToWin: z.number().int().min(5).max(50).optional(),
    maxPoints: z.number().int().min(5).max(60).optional(),
    gamesToWin: z.number().int().min(1).max(3).optional(),
  }).refine((o) => Object.values(o).some((v) => v !== undefined), { message: 'Không có gì để cập nhật' }),
  addEntries: z.object({
    entries: z.array(z.object({
      player1Name: name(120),
      player2Name: name(120).nullable().optional(),
      player1UserId: z.uuid().nullable().optional(),
      player2UserId: z.uuid().nullable().optional(),
      club: z.string().trim().max(120).optional(),
      rating: z.number().int().min(0).max(5000).nullable().optional(),
      seed: z.number().int().min(1).max(64).nullable().optional(),
      // Định danh VĐV (thẻ sinh viên / SĐT) — chuẩn hoá & kiểm tra kỹ ở athleteService.
      player1StudentId: z.string().trim().max(30).nullable().optional(),
      player1Phone: z.string().trim().max(30).nullable().optional(),
      // Email không dùng để định danh → sai định dạng thì athleteService bỏ qua, KHÔNG làm hỏng cả lô nhập.
      player1Email: z.string().trim().max(254).nullable().optional(),
      // true = người KHÁC dù trùng tên với hồ sơ đã có (BTC xác nhận ở bước xem trước khi nhập).
      player1NewAthlete: z.boolean().optional(),
      player2StudentId: z.string().trim().max(30).nullable().optional(),
      player2Phone: z.string().trim().max(30).nullable().optional(),
      player2Email: z.string().trim().max(254).nullable().optional(),
      player2NewAthlete: z.boolean().optional(),
    })).min(1).max(256),
  }),
  schedule: z.object({
    stage: z.enum(['group', 'knockout']).default('group'),
    startAt: z.iso.datetime({ offset: true }).optional(),
    courts: z.number().int().min(1).max(50).optional(),
    slotMinutes: z.number().int().min(5).max(240).optional(),
  }),
  disqualify: z.object({ reason: z.string().trim().min(3).max(300) }),
  swap: z.object({ entryA: z.uuid(), entryB: z.uuid() }),
  updateEntry: z.object({
    player1Name: name(120),
    player2Name: name(120).nullable().optional(),
    club: z.string().trim().max(120).optional(),
  }),
  devLogin: z.object({
    name: name(100).default('Admin Dev'),
    role: z.enum(['admin', 'user']).default('admin'),
  }),

  score: z.object({
    action: z.enum(['save', 'finish', 'walkover']),
    version: z.number().int().min(1),
    games: z.array(z.tuple([score, score])).max(5).optional(),
    walkoverWinner: z.enum(['a', 'b']).optional(),
  }),
  referee: z.object({ refereeUserId: z.uuid().nullable() }),
  callMatch: z.object({ court: z.number().int().min(1).max(50) }),
  roundRules: z.object({
    // stage 'group' = vòng bảng; 'knockout' + fromEnd (1 = chung kết, 2 = bán kết, 3 = tứ kết…), fromEnd null = mọi vòng loại.
    rules: z.array(z.object({
      stage: z.enum(['group', 'knockout']),
      fromEnd: z.number().int().min(1).max(6).nullable().optional(),
      pointsToWin: z.number().int().min(5).max(50),
      maxPoints: z.number().int().min(5).max(60),
      gamesToWin: z.number().int().min(1).max(3),
    })).max(8),
  }),
  draw: z.object({
    // Bảng có sẵn (từ file / lễ bốc thăm). Bỏ trống = bốc thăm ngẫu nhiên.
    groups: z.array(z.object({ name: z.string().trim().min(1).max(20), entryIds: z.array(z.uuid()).min(1).max(64) })).min(1).max(32).optional(),
  }),
  updateAthlete: z.object({
    fullName: name(120).optional(),
    studentId: z.string().trim().max(30).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    email: z.email().max(254).nullable().optional().or(z.literal('')),
    club: z.string().trim().max(120).optional(),
  }).refine((o) => Object.values(o).some((v) => v !== undefined), { message: 'Không có gì để cập nhật' }),
  moveMatch: z.object({
    court: z.number().int().min(1).max(50).nullable().optional(),
    scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
  }).refine((o) => o.court !== undefined || o.scheduledAt !== undefined, { message: 'Chọn sân hoặc giờ mới' }),
  courtParam: z.coerce.number().int().min(1).max(50),

  matchFilter: z.object({
    court: z.coerce.number().int().min(1).max(50).optional(),
    status: z.enum(['pending', 'scheduled', 'live', 'finished', 'walkover', 'bye']).optional(),
    categoryId: z.uuid().optional(),
  }),
  userSearch: z.object({ q: z.string().trim().min(1).max(60) }),
  userList: z.object({ q: z.string().trim().max(60).optional() }),
};

module.exports = { schemas };
