# Changelog

Theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/).

## [Unreleased]

### Added
- **Luật điểm theo vòng** (migration `007_round_rules`, `PUT /categories/:id/round-rules`): vòng bảng, mọi vòng loại trực tiếp, và từng vòng (tứ kết / bán kết / chung kết… đếm ngược từ chung kết, đặt được trước khi có nhánh); điểm 21/15/11 hoặc tuỳ chỉnh, 1 game / 2/3 / 3/5. Khoá theo từng trận đã bắt đầu (`RULES_LOCKED`). Bàn điểm, kiểm tra tỉ số và trang công khai dùng luật của vòng.
- **Bàn điểm: bên giao cầu & ô giao** (bên thắng pha giao tiếp; điểm chẵn → ô phải, lẻ → ô trái), hoàn tác trả lại bên giao, nút sửa bên giao.
- **Nhắc nghỉ & đổi sân**: nghỉ 60 s khi bên dẫn chạm nửa số điểm (11/8/6), nghỉ 2 phút + đổi sân giữa game, đổi sân ở game quyết định; đếm ngược, rung máy, tự đổi bên trên màn hình.
- **Giao diện Hệ thống / Sáng / Tối** (chân trang, sidebar quản trị, trang Tài khoản), lưu theo từng máy, không loé trắng khi tải trang.
- **Hồ sơ VĐV theo giải, nhận diện bằng MSSV + SĐT** (migration `006_athletes`): một người đánh nhiều nội dung là một hồ sơ; hai người trùng tên khác MSSV là hai người. Chống trùng lịch / gọi sân / gợi ý nghỉ so theo hồ sơ thay vì chuỗi tên. Tên mơ hồ hoặc MSSV/SĐT mâu thuẫn bị từ chối thay vì đoán. Dữ liệu cũ tự tạo hồ sơ theo tên.
- Trang **Quản trị › Vận động viên** (`GET /tournaments/:id/athletes`, `PATCH /athletes/:id`): tìm theo tên/MSSV/SĐT, gọi điện, sửa hồ sơ (đổi tên cập nhật mọi đội), nhãn trùng tên. MSSV/SĐT/email chỉ BTC thấy.
- **Nhập CSV Google Form**: nhận cột theo nghĩa (Họ và tên, MSSV, Số điện thoại, Khoa, Nội dung thi đấu chọn nhiều, cột đồng đội), chuẩn hoá SĐT/MSSV, bỏ qua người đã đăng ký theo MSSV → SĐT → tên. File mẫu và file xuất thêm cột MSSV/SĐT.
- **Chia bảng có sẵn**: cột "Bảng" trong file → chia đúng như file thay vì bốc thăm (`POST /categories/:id/draw {groups}`).
- **Cập nhật trực tiếp** (Server-Sent Events `GET /tournaments/:id/stream`): trang giải, bảng điều phối, màn hình TV tải lại ~0,5 s sau khi có điểm / gọi sân / dời trận; polling giữ làm dự phòng.
- **Màn hình chiếu** `/t/<slug>/tv`: tỉ số chữ lớn từng sân, "MỜI RA SÂN" nhấp nháy, trận sắp tới, đồng hồ, toàn màn hình.
- **Điều phối sân** (`/t/<slug>/admin/courts`): mỗi sân một thẻ (trống / đã gọi / đang đánh, số phút trên sân); gợi ý trận kế tiếp cho sân trống (cả 2 đội rảnh, ưu tiên VĐV đã nghỉ ≥ 10 phút); **gọi vào sân**, **rút về** hàng chờ, **chuyển sân**; hàng chờ báo "X đang ở sân N" / "nghỉ thêm ~N′". Chặn 1 VĐV ở 2 sân cùng lúc, kể cả khác nội dung. Công khai hiện nhãn **"Mời ra sân"**. API `GET /tournaments/:id/courts`, `POST /matches/:id/call|uncall` (migration `005_court_ops`).
- **Dời một trận** (`PATCH /matches/:id`): đổi giờ / sân không phải xếp lại cả giai đoạn; chặn trùng sân / trùng VĐV trong cùng khung giờ. Nút **Dời** ở Trận đấu & trọng tài và hàng chờ.
- **Trọng tài phụ trách sân** (`PUT /tournaments/:id/courts/:court/referee`): trận chưa gán trọng tài riêng thuộc trọng tài của sân; hàng đợi `/ref` đưa trận ở sân mình lên đầu.
- **Bàn điểm chịu được mất mạng**: điểm lưu vào máy (`localStorage`) trước khi gửi, tự gửi lại khi có mạng, khôi phục điểm chưa gửi và lịch sử Hoàn tác sau khi tải lại trang; bỏ bản nháp nếu máy khác đã sửa trận.
- **Web độc lập, tài khoản riêng**: đăng nhập tên đăng nhập + mật khẩu (`/login`, `POST /api/auth/login`), mật khẩu scrypt, chống dò tài khoản, rate limit; đổi mật khẩu (`/accounts`, `POST /api/me/password`) đăng xuất các thiết bị khác.
- **Quản lý tài khoản** cho quản trị viên (`/accounts`, `/api/admin/users`): tạo, sửa, đặt lại mật khẩu, khoá / mở khoá; chặn khoá/hạ quyền quản trị viên cuối cùng. `npm run user:create` tạo quản trị viên đầu tiên.
- **Nhập / xuất danh sách VĐV bằng Excel** (.xlsx, xử lý trên trình duyệt): file mẫu, xem trước có báo dòng lỗi, tự bỏ đội trùng, nhập nhiều nội dung một lần; xuất theo nội dung hoặc toàn giải.
- Tab **Bảng đấu** `/t/<slug>/groups` và mục "Bảng đấu" trên thanh điều hướng.

### Changed
- README viết lại: giới thiệu, tính năng, kiến trúc (sơ đồ), luồng dữ liệu (ghi điểm → SSE, đăng ký → bảng đấu), mô hình dữ liệu, cấu trúc thư mục, bảng biến môi trường, triển khai; bỏ badge CI trỏ tới repo chưa tồn tại.
- Sửa luật điểm mặc định của nội dung chỉ bị khoá khi có trận đã bắt đầu đang dùng luật mặc định (trước đây: khi có bất kỳ trận nào bắt đầu).
- Chữ phụ `text-slate-400` nâng lên đạt WCAG AA trên nền sáng; nhãn giao cầu, chữ "vs" trên TV đủ tương phản.
- Trang giải gộp thành **một khung 3 tab** (Lịch thi đấu `/t/<slug>` · Bảng đấu `/t/<slug>/groups` · Loại trực tiếp `/t/<slug>/bracket`), dùng chung cho thanh điều hướng và trang giải — trước đây bấm "Lịch thi đấu" trên thanh điều hướng mở một trang khác với trang giải. `/t/<slug>/schedule` chuyển hướng về trang mới, giữ bộ lọc.
- Vai trò tài khoản: `admin` | `user` (migration `004_standalone_auth`, giữ nguyên dữ liệu cũ; user cũ được admin đặt tên đăng nhập + mật khẩu 1 lần).
- Thanh điều hướng trên điện thoại gọn lại (chỉ logo + nút biểu tượng) để không tràn ở 375px.
- Test HTTP chạy trên PGlite (không còn bị bỏ qua khi thiếu Postgres).
- Xoá đội / nội dung thì xoá luôn hồ sơ VĐV không còn ở đội nào (không giữ MSSV/SĐT thừa).
- Xếp lịch lại không đụng trận đã gọi vào sân; sân và VĐV của trận đã gọi bị chặn ở khung đầu như trận đang đánh.

### Security
- Nâng Next.js 16.2.6 → **16.4.5** (và `eslint-config-next`) để vá các lỗ hổng critical ≤ 16.4.4 (gồm RCE trên máy chủ Windows, SSRF qua rewrites, cache poisoning). `npm audit --omit=dev`: 0 lỗ hổng. Còn cảnh báo ReDoS `picomatch` chỉ trong công cụ lint (dev), chưa có bản vá.

### Removed
- **SSO SmashTeam** (vé ES256, `/sso`, `SSO_PUBLIC_KEY`, `npm run keys`, `npm run dev:ticket`, thư mục `integration/`), cột `users.elo`, bảng `sso_ticket_uses`, `tournaments.smashteam_event_id`.

### Added (trước đó)
- **Giải mở rộng**: bốc thăm chia bảng ngẫu nhiên (CSPRNG), tách đội cùng CLB; bốc thăm lại luôn ra cách chia khác; bốc thăm phụ làm tiêu chí phân hạng cuối.
- Truất quyền thi đấu (vòng bảng huỷ mọi kết quả theo BWF; nhánh xử W.O, tự W.O khi đối thủ tới) và huỷ truất quyền có khôi phục.
- Đổi bảng 2 đội (sinh lại vòng tròn), sửa đội/VĐV trước khi thi đấu.
- **CRUD nội dung thi đấu** cho BTC: sửa (khoá theo giai đoạn), xoá khi chưa trận nào bắt đầu (`PATCH/DELETE /api/categories/:id`).
- Xếp lịch theo giai đoạn: loại trực tiếp bắt buộc ngày giờ, ghi đè số sân/phút, xếp cả nhánh một lần theo trận dẫn vào; chặn giờ đã qua và sân đang có trận.
- Nhật ký thao tác BTC append-only (`tournament_events`), giữ lại khi xoá nội dung.
- Trang công khai **Lịch thi đấu** `/t/<slug>/schedule`: theo giờ / theo sân / dạng bảng / cây loại trực tiếp; lọc nội dung, ngày, sân trên URL; mục "Lịch thi đấu" trên thanh điều hướng.
- Quản trị giải tách thành 6 trang (Tổng quan, Nội dung & VĐV, Xếp lịch sân, Trận đấu & trọng tài, Ban tổ chức, Nhật ký) với sidebar.
- Chạy dev không cần Postgres (`DATABASE_URL=pglite:...`), đăng nhập dev (`DEV_LOGIN=1`, bị từ chối ở production), `npm run seed:demo`.
- Tài liệu chức năng hệ thống [`docs/FEATURES.md`](docs/FEATURES.md).
- `package-lock.json` cho backend & frontend (CI `npm ci` chạy được).

### Changed (trước đó)
- Giao diện theo cấu trúc web CLB (thanh điều hướng nổi, thẻ trắng, nút đen, sidebar quản trị), màu đỏ–đen Smash Open Cup, font Inter + Barlow Condensed, icon lucide.
- Patch SSO tạo lại theo SmashTeam `a18f590`, kèm sửa open redirect ở `/login?redirect=`.
- Migration runner tự ghi `schema_migrations`.
- `/t/<slug>/bracket` chuyển hướng sang Lịch thi đấu (kiểu cây).

### Removed (trước đó)
- Bốc thăm rắn bò theo ELO/hạt giống và cột ELO ở định dạng nhập danh sách.
- Nút chuyển Sáng/Tối (giao diện nền sáng như web CLB) — đã thêm lại dạng Hệ thống / Sáng / Tối ở bản sau.

### Added (MVP ban đầu)
- MVP web quản lý giải: tạo giải/nội dung, nhập danh sách, bốc thăm rắn bò theo ELO, lịch vòng tròn, xếp lịch sân chống trùng VĐV giữa các nội dung.
- BXH vòng bảng (thắng → đối đầu → hiệu số game → hiệu số điểm), nhánh loại trực tiếp có bye, tự đưa đội thắng vào vòng sau.
- Bàn nhập điểm trọng tài cho điện thoại với optimistic locking, hoàn tác, bỏ cuộc; BTC mở lại trận có kiểm soát; nhật ký điểm append-only.
- SSO từ SmashTeam bằng ticket ES256 một lần + patch cho repo SmashTeam.
- Trang công khai: đang thi đấu, lịch theo giờ/sân, bảng, nhánh; giao diện Sáng/Tối/Theo hệ thống.
- Phân tích site & repo SmashTeam (`docs/ANALYSIS.md`).
