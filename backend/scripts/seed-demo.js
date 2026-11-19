'use strict';
/**
 * CHỈ DEV: tạo giải demo "Smash Open Cup 2026" (2 nội dung, VĐV nhiều CLB, đã bốc thăm, xếp lịch vòng bảng,
 * vài trận đã có kết quả / đang đánh) để xem prototype. Chạy lại an toàn: giải đã có thì bỏ qua.
 * Dùng: npm run seed:demo
 */
const crypto = require('node:crypto');
const { createPool } = require('../src/db');
const svc = require('../src/services/tournamentService');
const { hashPassword } = require('../src/auth');

if (process.env.NODE_ENV === 'production') {
  process.stderr.write('Từ chối: không seed demo ở production\n');
  process.exit(1);
}

/**
 * Tài khoản dev cố định (id tất định để chạy lại seed không nhân bản). Cùng username với auth.devSession
 * → nút "Dev: Admin / Dev: Trọng tài" đăng nhập đúng user này. Mật khẩu dev cho form đăng nhập:
 * DEV_SEED_PASSWORD hoặc mặc định bên dưới — CHỈ dùng trên máy dev (script từ chối chạy ở production).
 */
const DEV_PASSWORD = process.env.DEV_SEED_PASSWORD || 'smash-dev-2026';
function devUser(name, role, username) {
  const h = crypto.createHash('sha256').update(`dev:${name}`).digest('hex');
  return { id: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`, full_name: name, role, username };
}

async function ensureDevUsers(pool, users) {
  const hash = await hashPassword(DEV_PASSWORD);
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (id, username, full_name, role, password_hash) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, role = EXCLUDED.role,
         password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash)`,
      [u.id, u.username, u.full_name, u.role, hash],
    );
  }
}

const SINGLES = [
  ['Nguyễn Minh Khoa', 'Smash Team'], ['Trần Đức Huy', 'Smash Team'], ['Lê Quang Vinh', 'Smash Team'],
  ['Phạm Gia Bảo', 'CLB Quận 7'], ['Võ Thành Đạt', 'CLB Quận 7'], ['Đặng Hoàng Nam', 'CLB Thủ Đức'],
  ['Bùi Anh Tuấn', 'CLB Thủ Đức'], ['Hồ Tấn Lộc', 'Bách Khoa Badminton'], ['Ngô Phúc Thịnh', 'Bách Khoa Badminton'],
  ['Dương Khải', ''], ['Lý Trọng Nhân', ''], ['Trịnh Công Sơn', 'CLB Gò Vấp'],
];
const MIXED = [
  ['Nguyễn Thảo Vy', 'Trần Quốc Bảo', 'Smash Team'], ['Lê Hà My', 'Phan Đức Anh', 'Smash Team'],
  ['Phạm Ngọc Hân', 'Đỗ Minh Trí', 'CLB Quận 7'], ['Võ Khánh Linh', 'Huỳnh Gia Huy', 'CLB Thủ Đức'],
  ['Mai Phương Anh', 'Tạ Quang Hưng', 'Bách Khoa Badminton'], ['Lâm Bảo Ngọc', 'Châu Thiện Nhân', ''],
  ['Kiều Diễm', 'Vũ Hoàng Long', 'CLB Gò Vấp'], ['Tô Ngọc Trâm', 'La Văn Phúc', 'CLB Quận 7'],
];

const WOMEN = [
  ['Nguyễn Thu Trang', 'Smash Team'], ['Lê Ngọc Ánh', 'Smash Team'], ['Phạm Mai Chi', 'CLB Quận 7'],
  ['Trần Bảo Hân', 'CLB Quận 7'], ['Võ Thị Yến', 'CLB Thủ Đức'], ['Đỗ Khánh Vy', 'Bách Khoa Badminton'],
  ['Huỳnh Diệu Linh', 'Bách Khoa Badminton'], ['Bùi Minh Thư', 'CLB Gò Vấp'], ['Lý Gia Hân', ''],
  ['Hồ Ngọc Diệp', ''], ['Phan Tú Anh', 'CLB Gò Vấp'], ['Châu Mỹ Duyên', 'CLB Thủ Đức'],
];

/**
 * Nội dung WS: vòng bảng đã xong → nhánh 8 đội (tứ kết → chung kết), xếp lịch ngày hôm sau,
 * 3 trận tứ kết đã có kết quả, 1 trận đang đánh — để xem cây thi đấu có dữ liệu thật.
 * @returns {Promise<boolean>} true nếu vừa tạo
 */
async function ensureKnockoutDemo(pool, admin, t) {
  const has = await pool.query(`SELECT 1 FROM categories WHERE tournament_id = $1 AND code = 'WS'`, [t.id]);
  if (has.rows[0]) return false;
  const ws = await svc.createCategory(pool, admin, t.id, { code: 'WS', name: 'Đơn nữ', isDoubles: false, groupCount: 4, advancePerGroup: 2 });
  await svc.addEntries(pool, admin, ws.id, WOMEN.map(([player1Name, club]) => ({ player1Name, club })));
  await svc.drawGroups(pool, admin, ws.id);
  const groupScores = [[[21, 15], [21, 18]], [[19, 21], [21, 17], [21, 16]], [[21, 11], [21, 13]], [[17, 21], [18, 21]]];
  const groupMatches = await svc.listMatches(pool, t.id, { categoryId: ws.id });
  for (const [k, m] of groupMatches.entries()) {
    await svc.recordScore(pool, admin, m.id, { action: 'finish', version: m.version, games: groupScores[k % groupScores.length] });
  }
  await svc.generateKnockout(pool, admin, ws.id);
  const day2 = new Date(new Date(t.starts_at).getTime() + 86_400_000).toISOString().slice(0, 10);
  await svc.scheduleTournament(pool, admin, t.id, { stage: 'knockout', startAt: `${day2}T08:00:00+07:00`, courts: 4, slotMinutes: 40 });
  const qf = (await svc.getBracket(pool, ws.id)).rounds[0].matches;
  const koScores = [[[21, 16], [21, 19]], [[21, 23], [21, 14], [21, 18]], [[15, 21], [12, 21]]];
  for (const [k, games] of koScores.entries()) {
    const m = await svc.getMatch(pool, qf[k].id);
    await svc.recordScore(pool, admin, m.id, { action: 'finish', version: m.version, games });
  }
  const live = await svc.getMatch(pool, qf[3].id);
  await svc.recordScore(pool, admin, live.id, { action: 'save', version: live.version, games: [[21, 19], [9, 12]] });
  return true;
}

async function main() {
  const pool = createPool(process.env.DATABASE_URL ?? '');
  try {
    const admin = devUser('Admin Dev', 'admin', 'dev-admin');
    const ref = devUser('Trọng tài Dev', 'user', 'dev-user');
    await ensureDevUsers(pool, [admin, ref]);
    const existing = (await pool.query('SELECT * FROM tournaments WHERE slug = $1', ['smash-open-cup-2026'])).rows[0];
    if (existing) {
      const added = await ensureKnockoutDemo(pool, admin, existing);
      process.stdout.write(added ? 'Đã bổ sung nội dung WS (cây thi đấu) vào giải demo.\n' : 'Giải demo đã đầy đủ — bỏ qua.\n');
      return;
    }
    // Khai mạc: 08:00 giờ VN, 7 ngày tới.
    const d = new Date(Date.now() + 7 * 86_400_000);
    const day = d.toISOString().slice(0, 10);
    const t = await svc.createTournament(pool, admin, {
      slug: 'smash-open-cup-2026', name: 'Smash Open Cup 2026', venue: 'Nhà thi đấu ĐH CNTT (UIT), TP.HCM',
      startsAt: `${day}T08:00:00+07:00`, courts: 4, slotMinutes: 30,
    });
    await svc.upsertStaff(pool, admin, t.id, { userId: ref.id, role: 'referee' });

    const ms = await svc.createCategory(pool, admin, t.id, { code: 'MS', name: 'Đơn nam', isDoubles: false, groupCount: 3, advancePerGroup: 2 });
    const xd = await svc.createCategory(pool, admin, t.id, { code: 'XD', name: 'Đôi nam nữ', isDoubles: true, groupCount: 2, advancePerGroup: 2 });
    await svc.addEntries(pool, admin, ms.id, SINGLES.map(([player1Name, club]) => ({ player1Name, club })));
    await svc.addEntries(pool, admin, xd.id, MIXED.map(([player1Name, player2Name, club]) => ({ player1Name, player2Name, club })));
    await svc.drawGroups(pool, admin, ms.id);
    await svc.drawGroups(pool, admin, xd.id);
    await svc.scheduleTournament(pool, admin, t.id, { stage: 'group' });
    await svc.updateTournament(pool, admin, t.id, { status: 'published' });

    // Vài kết quả ở Đơn nam để bảng xếp hạng / "đang thi đấu" có dữ liệu.
    const list = (await svc.listMatches(pool, t.id, { categoryId: ms.id })).filter((m) => m.status === 'scheduled');
    const scores = [[[21, 17], [21, 19]], [[18, 21], [21, 15], [21, 12]], [[21, 9], [21, 14]]];
    for (const [i, games] of scores.entries()) {
      const m = list[i];
      await svc.recordScore(pool, admin, m.id, { action: 'finish', version: m.version, games });
    }
    const live = list[3];
    await svc.recordScore(pool, admin, live.id, { action: 'save', version: live.version, games: [[21, 18], [11, 9]] });
    await ensureKnockoutDemo(pool, admin, t);
    process.stdout.write(`Đã tạo giải demo: /t/${t.slug}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => { process.stderr.write(`Seed thất bại: ${err.message}\n`); process.exit(1); });
