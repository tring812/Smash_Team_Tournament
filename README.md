# SmashTeam Tournament

Last updated: 2026-11-18 10:55 PM CST

[![CI](https://github.com/Taiyo1108/smashteam-tournament/actions/workflows/ci.yml/badge.svg)](https://github.com/Taiyo1108/smashteam-tournament/actions/workflows/ci.yml)

Web quản lý giải đấu cầu lông **độc lập**: bốc thăm chia bảng **ngẫu nhiên** hoặc theo bảng có sẵn, **nhập danh sách từ Excel / CSV Google Form** (nhận diện VĐV bằng **MSSV + SĐT**), **điều phối sân** theo sân trống, **màn hình chiếu TV** cập nhật trực tiếp, xếp lịch sân, bảng xếp hạng, nhánh loại trực tiếp và **bàn nhập điểm cho trọng tài trên điện thoại**. Tài khoản riêng (tên đăng nhập + mật khẩu) do quản trị viên cấp; khán giả xem không cần đăng nhập.

> Badge CI chỉ đúng sau khi repo được đẩy lên GitHub với đúng đường dẫn trên — sửa owner/repo nếu khác.

## Contents

- [Kiến trúc](#kiến-trúc)
- [Chạy trên máy](#chạy-trên-máy)
- [Tài khoản & triển khai](#tài-khoản--triển-khai)
- [Quy trình một giải](#quy-trình-một-giải)
- [API](#api)
- [Kiểm thử](#kiểm-thử)
- [Bảo mật](#bảo-mật)
- [Troubleshooting](#troubleshooting)
- [Giới hạn đã biết](#giới-hạn-đã-biết)

**Danh sách đầy đủ chức năng, phân quyền, quy tắc nghiệp vụ: [docs/FEATURES.md](docs/FEATURES.md).** Phân tích ban đầu (thiết kế SSO cũ, đã thay thế): [docs/ANALYSIS.md](docs/ANALYSIS.md).

## Kiến trúc

| Thư mục | Nội dung |
|---|---|
| `backend/` | Express 5 + `pg` + zod, Node ≥ 20.19. `src/domain/` = logic thuần (bốc thăm ngẫu nhiên, vòng tròn, xếp lịch, BXH, nhánh, luật điểm); `src/services/` = nghiệp vụ + SQL; `src/app.js` = HTTP |
| `backend/migrations/` | Schema PostgreSQL (`004_standalone_auth` = tài khoản riêng) |
| `frontend/` | Next.js 16 App Router + Tailwind 4. `/api/*` được proxy sang backend → một origin, cookie httpOnly. Excel đọc/ghi trên trình duyệt (`app/lib/excel.ts`) |

<sub>[↑ Back to contents](#contents)</sub>

## Chạy trên máy

Yêu cầu: Node 20.19+, Docker (hoặc PostgreSQL 14+).

```bash
docker compose up -d db                       # Postgres dev ở cổng 5433
cd backend
cp .env.example .env                          # SESSION_SECRET=$(openssl rand -base64 48)
npm ci
npm run migrate
npm run user:create -- --username admin --name "Ban tổ chức" --role admin   # in mật khẩu tạm 1 lần
npm run dev                                   # API :5100

cd ../frontend
cp .env.example .env.local
npm ci && npm run dev                         # Web :3100
```

**Không có Docker/Postgres?** Đặt `DATABASE_URL=pglite:.pgdata` (Postgres WASM chạy ngay trong tiến trình, chỉ dùng khi dev) và `DEV_LOGIN=1` trong `backend/.env`, rồi:

```bash
cd backend && npm run migrate && npm run seed:demo   # tạo giải demo "Smash Open Cup 2026"
```

Trang `/login` sẽ có nút **Dev: Admin / Dev: Trọng tài** (đăng nhập 1 chạm; config từ chối `DEV_LOGIN` ở production). Seed cũng tạo 2 tài khoản dev `dev-admin` / `dev-user` có mật khẩu (xem `DEV_PASSWORD` trong `backend/scripts/seed-demo.js`) để thử form đăng nhập thật.

<sub>[↑ Back to contents](#contents)</sub>

## Tài khoản & triển khai

Web chạy độc lập, không liên kết hệ thống nào khác.

1. Backend env: `DATABASE_URL`, `SESSION_SECRET` (≥ 32 ký tự), `PUBLIC_ORIGIN=https://<domain>`; frontend env: `BACKEND_URL`.
2. `npm run migrate`, rồi tạo **quản trị viên đầu tiên**:
   `NEW_USER_PASSWORD='<mật khẩu>' npm run user:create -- --username admin --name "Ban tổ chức" --role admin`
   (bỏ `NEW_USER_PASSWORD` → script sinh mật khẩu tạm và in đúng 1 lần). Chạy lại với cùng username = đặt lại mật khẩu + mở khoá.
3. Quản trị viên đăng nhập `/login` → **Tài khoản** (`/accounts`) tạo tài khoản cho BTC, trọng tài (vai trò *Người dùng*). Không có đăng ký công khai.
4. BTC thêm người vào giải ở **Quản trị › Ban tổ chức**.

Nâng cấp từ bản SSO cũ: migration `004_standalone_auth` giữ nguyên user, BTC, nhật ký; user cũ chưa có mật khẩu → quản trị viên đặt ở `/accounts` (hoặc `user:create` cho admin).

<sub>[↑ Back to contents](#contents)</sub>

## Quy trình một giải

1. Quản trị viên: **Tạo giải** → **Quản trị › Nội dung & VĐV**: thêm / sửa / xoá nội dung (mã, đơn/đôi, số bảng, số đội đi tiếp, luật điểm mặc định) và **Luật điểm theo vòng** (vd vòng bảng 11 điểm 1 game, chung kết 21 BWF).
2. **Excel › Nhập Excel / CSV**: dùng thẳng file CSV tải từ Google Form đăng ký (họ tên, MSSV, SĐT, nội dung — chọn nhiều được, đồng đội), hoặc **File mẫu**. Xem trước → nhập. Có cột **Bảng** (đã chia sẵn) → chia bảng theo file. Kiểm tra / sửa MSSV, SĐT ở **Quản trị › Vận động viên**. **Bốc thăm** ngẫu nhiên (tách VĐV cùng CLB, sinh lịch vòng tròn; bốc lại được khi chưa đánh). **Xuất toàn giải** ra Excel bất cứ lúc nào.
3. **Ban tổ chức**: tìm tài khoản → thêm **Trọng tài**/**BTC**. **Xếp lịch sân › Vòng bảng** → chuyển trạng thái **Công bố**.
4. Ngày thi đấu: **Quản trị › Điều phối sân** — giao trọng tài cho từng sân; sân trống → **Gọi vào sân** trận được gợi ý (VĐV rảnh, đã nghỉ đủ); trễ giờ thì cứ gọi theo sân trống, hoặc **Dời** từng trận. Trọng tài mở **/ref** (trận ở sân mình lên đầu), chọn bên giao trước, chạm nửa màn hình bên ghi điểm — màn hình báo bên giao + ô giao, nhắc nghỉ 60 s / 2 phút và đổi sân; mất mạng vẫn chấm tiếp, điểm tự gửi khi có mạng. Đủ game → **Xác nhận kết quả**. Mở **Chiếu màn hình** (`/t/<slug>/tv`) trên TV nhà thi đấu. Khán giả xem trang giải (cập nhật trực tiếp): **Lịch thi đấu** `/t/<slug>` (theo giờ / theo sân / dạng bảng) · **Bảng đấu** `/t/<slug>/groups` · **Loại trực tiếp** `/t/<slug>/bracket` (cây / bảng).
5. Hết vòng bảng → **Tạo nhánh loại trực tiếp** → **Xếp lịch sân › Loại trực tiếp** (bắt buộc chọn ngày giờ; xếp cả nhánh một lần).
6. Sai tỉ số? BTC bấm **Mở lại** (chỉ khi trận vòng sau chưa bắt đầu). Vi phạm? **Truất quyền** (có lý do, ghi nhật ký).

Chi tiết từng chức năng và quy tắc: [docs/FEATURES.md](docs/FEATURES.md).

<sub>[↑ Back to contents](#contents)</sub>

## API

Lỗi trả về `application/problem+json` (`status`, `code`, `title`, `issues`). Request ghi phải có header `X-Requested-With: fetch`.

| Method | Path | Quyền |
|---|---|---|
| POST | `/api/auth/login` `{username, password}` · `/api/auth/logout` | — |
| POST | `/api/me/password` `{currentPassword, newPassword}` | đã đăng nhập |
| GET/POST · PATCH | `/api/admin/users` · `/api/admin/users/:id` | quản trị viên |
| GET | `/api/me`, `/api/tournaments`, `/api/tournaments/:slug` | công khai (giải nháp chỉ BTC) |
| POST/PATCH | `/api/tournaments`, `/api/tournaments/:id` | quản trị viên / BTC |
| GET/PUT/DELETE | `/api/tournaments/:id/staff[/:userId]` | BTC |
| POST | `/api/tournaments/:id/categories`, `/api/tournaments/:id/schedule` `{stage, startAt?, courts?, slotMinutes?}` | BTC |
| PATCH/DELETE | `/api/categories/:id` (sửa / xoá nội dung) | BTC |
| GET | `/api/tournaments/:id/events` (nhật ký thao tác) | BTC |
| GET | `/api/tournaments/:id/matches?court&status&categoryId` | công khai |
| GET | `/api/categories/:id/entries · standings · bracket` | công khai |
| POST | `/api/categories/:id/entries · draw · swap · knockout` | BTC |
| PATCH/DELETE | `/api/entries/:id`; POST `/api/entries/:id/disqualify · reinstate` | BTC |
| GET | `/api/matches/:id`, `/api/referee/queue` | công khai / trọng tài |
| PUT | `/api/matches/:id/score` `{action: save\|finish\|walkover, version, games}` | trọng tài / BTC |
| GET · PUT | `/api/tournaments/:id/courts` · `/api/tournaments/:id/courts/:court/referee` | BTC |
| GET · PATCH | `/api/tournaments/:id/athletes` · `/api/athletes/:id` (hồ sơ VĐV, có MSSV/SĐT) | BTC |
| PUT | `/api/categories/:id/round-rules` (luật điểm theo vòng) | BTC |
| GET | `/api/tournaments/:id/stream` (Server-Sent Events) | công khai (giải nháp chỉ BTC) |
| POST · PATCH | `/api/matches/:id/call` · `/api/matches/:id/uncall` · `/api/matches/:id` `{court?, scheduledAt?}` | BTC |
| POST/PUT | `/api/matches/:id/reopen`, `/api/matches/:id/referee` | BTC |
| GET | `/api/users?q=` | BTC |

<sub>[↑ Back to contents](#contents)</sub>

## Kiểm thử

```bash
cd backend
npm test                                                     # domain + config + service & HTTP trên PGlite (không cần cài Postgres)
TEST_PG_HOST=localhost TEST_PG_PORT=5433 TEST_PG_DB=tournament_test npm test   # + bộ test service với Postgres thật
```

`TEST_PG_DB` phải chứa chữ `test` (DB bị xoá sạch). Khi chưa cài `pg`, test service tự dùng adapter `psql` (chỉ cho test).

<sub>[↑ Back to contents](#contents)</sub>

## Bảo mật

- Mật khẩu: scrypt (salt riêng), so sánh thời gian hằng; sai tên / sai mật khẩu cùng một lỗi và cùng thời gian. Rate limit 20 lần / 15 phút / IP.
- Phiên: cookie `httpOnly; SameSite=Lax; Secure`(prod) 12h; vai trò, trạng thái khoá và `session_version` đọc lại từ DB mỗi request → đổi mật khẩu / khoá tài khoản đăng xuất mọi phiên cũ ngay.
- CSRF: header tuỳ biến + kiểm tra `Origin`.
- Excel xử lý trên trình duyệt, server không nhận file.
- Mọi query tham số hoá; mọi body validate bằng zod; nhật ký điểm append-only (trigger).
- Bí mật chỉ qua env/secret manager — không commit `.env`.

<sub>[↑ Back to contents](#contents)</sub>

## Troubleshooting

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| API thoát ngay: `Cấu hình không hợp lệ` | Thiếu/sai env — thông báo liệt kê từng biến |
| Đăng nhập báo "Sai tên đăng nhập hoặc mật khẩu" dù đúng | Tài khoản bị khoá hoặc chưa có mật khẩu (user từ bản SSO cũ) → quản trị viên đặt mật khẩu ở `/accounts` |
| Quên mật khẩu quản trị viên duy nhất | `npm run user:create -- --username <tên> --role admin` trên máy chủ → đặt lại mật khẩu |
| Đăng nhập báo "Thử quá nhiều lần" (429) | Quá 20 lần / 15 phút từ một IP — đợi rồi thử lại |
| Nhập Excel báo "Không tìm thấy dòng tiêu đề" | Dòng tiêu đề phải nằm trong 10 dòng đầu và có cột `VĐV 1` (hoặc `Họ tên`) — dùng **File mẫu** |
| Nhập Excel báo "đã bốc thăm" | Nội dung đó đã bốc thăm, không nhận thêm đội |
| Gọi trận báo "Sân N đang có trận" / "X đang ở sân N" | Sân hoặc VĐV đang bận (đang đánh hoặc đã gọi). Kết thúc / **Rút về** trận kia, hoặc chọn sân khác |
| Không **Rút về** được trận | Trận đã có điểm — dùng **Chuyển sân** |
| Bàn điểm báo "Mất kết nối — điểm đã lưu trên máy này" | Bình thường khi wifi chập chờn: cứ chấm tiếp, điểm tự gửi khi có mạng. Đừng xoá dữ liệu trình duyệt trước khi thấy "Đã lưu" |
| Nhập báo "Có N VĐV tên X — nhập MSSV hoặc SĐT" | Có nhiều người trùng tên trong giải; thêm MSSV/SĐT vào dòng đó |
| Nhập báo "MSSV … là của A nhưng SĐT … là của B" | Một trong hai bị gõ nhầm — kiểm tra ở **Vận động viên** |
| CSV lỗi dấu tiếng Việt | File không phải UTF-8: Google Form → Tải xuống .csv; Excel → *Lưu thành → CSV UTF-8* |
| Có cột Bảng mà không chia bảng theo file | Nội dung đã có đội trước đó, có dòng thiếu Bảng, hoặc bảng chỉ 1 đội — xem lỗi trong hộp Xem trước |
| Trang giải / TV không hiện "Trực tiếp" | Proxy/CDN chặn Server-Sent Events (cần tắt buffering cho `/api/*/stream`) — trang vẫn tự làm mới 10–15 giây |
| Lưu luật theo vòng báo "… đã có trận bắt đầu" | Vòng đó đã có trận đang đánh / có kết quả — chỉ đổi được vòng chưa đánh |
| Bàn điểm báo sai bên giao | Bấm **Sửa bên giao** (bên giao lưu trên máy trọng tài, đổi máy giữa trận thì chọn lại) |
| Bàn điểm báo "đã bỏ bản nháp trên máy này" | Máy khác đã sửa trận trong lúc máy này mất mạng — tỉ số máy chủ được giữ, kiểm tra lại với trọng tài kia |
| Ghi dữ liệu trả 403 `CSRF` | Gọi API trực tiếp thiếu `X-Requested-With: fetch`, hoặc `PUBLIC_ORIGIN` khác domain đang mở |
| Trọng tài thấy "đã tải lại bản mới nhất" | Hai máy cùng nhập 1 trận (409). Thống nhất 1 máy/trận hoặc phân công trọng tài |
| Không tạo được nhánh | Còn trận vòng bảng chưa kết thúc — xem thông báo tên bảng |
| Không mở lại được trận | Trận vòng sau đã bắt đầu, hoặc đã tạo nhánh (với trận vòng bảng) |
| Sửa nội dung báo 409 `CATEGORY_LOCKED` | Trường đó đã khoá theo giai đoạn: đơn/đôi khi đã có đội, số bảng khi đã bốc thăm, luật điểm khi đã có trận bắt đầu |
| Không xoá được nội dung (`CATEGORY_STARTED`) | Nội dung đã có trận được nhập điểm |
| Xếp lịch báo "Giờ bắt đầu đã qua" | Chọn giờ trong tương lai; với vòng bảng, giờ khai mạc đã qua thì phải nhập giờ bắt đầu |
| Đổi giao diện mà trang vẫn hiện font/màu cũ (dev) | Cache dev của Next: dừng web, xoá `frontend/.next`, chạy lại `npm run dev` |
| `npm run seed:demo` báo lỗi khoá DB (PGlite) | PGlite chỉ cho 1 tiến trình mở thư mục DB: dừng API rồi chạy seed |

<sub>[↑ Back to contents](#contents)</sub>

## Giới hạn đã biết

- Kênh trực tiếp (SSE) trong bộ nhớ → 1 instance API (nhiều instance: cần LISTEN/NOTIFY hoặc Redis).
- Bỏ cuộc tính thắng, không tính game/điểm đã đánh.
- Số bảng lẻ (vd 3 bảng × 2): có thể gặp lại đội cùng bảng ở vòng 2.
- Rate limit trong bộ nhớ → chỉ đúng với 1 instance.
- Không đổi số bảng sau khi bốc thăm.
- Chưa có "quên mật khẩu" qua email (quản trị viên đặt lại).

<sub>[↑ Back to contents](#contents)</sub>
