# Changelog

Theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/).

## [Unreleased]

### Fixed
- **Bảng điểm không còn lùi về tỉ số cũ** khi có điểm liên tục: trước đây mỗi lần tải lại (do có thay đổi trực tiếp hoặc tới chu kỳ làm mới) chạy song song với lần trước, response về sau cùng thắng nên trang công khai / màn hình TV / điều phối sân đôi khi hiện tỉ số cũ trong giây lát. Nay lần tải mới huỷ lần tải còn dở và chỉ kết quả mới nhất được hiển thị.
- **Sửa đội không còn cho phép trùng VĐV trong cùng nội dung**: `PATCH /entries/:id` từ chối với `409 ATHLETE_ALREADY_ENTERED` nếu một trong hai VĐV đã thuộc đội khác, tránh sinh trận VĐV đấu với chính mình. Vẫn cho phép đảo thứ tự thành viên trong cùng đội và tham gia nhiều nội dung; thao tác bị từ chối không để lại thay đổi hồ sơ hoặc nhật ký.
- **Bàn điểm sau khi xác nhận** hiện tỉ số cuối (vd 21–0) thay vì 0–0, và giữ biên bản để xem.
- **Bàn điểm khoá khi giải "Đã kết thúc"**: trước đây máy chủ từ chối nhưng giao diện vẫn cho chọn bên giao và bấm điểm, số điểm hiện lên rồi giữ nguyên. Nay hiện banner "Giải đã kết thúc — khoá nhập điểm" và làm mờ mọi nút; thao tác bị máy chủ từ chối thì **trả điểm về như trước**. Mọi API trả trận có thêm `tournamentStatus`.
- **Gọi vào sân không còn ghi đè giờ / sân dự kiến**: trước đây bấm "Gọi vào sân" đổi giờ dự kiến thành giờ gọi (vd 18:00 → 17:27), rút về thì trận mang giờ mới và sân cũ nên bị đẩy lên đầu hàng chờ. Nay giờ gọi lưu riêng (`called_at`), sân dự kiến cất ở cột mới `planned_court`; **Rút về** trả lại đúng giờ và sân dự kiến. **Migration 009** thêm cột và sửa lại các trận đã bị ghi đè (lấy giờ / sân dự kiến từ nhật ký gọi trận).

### Changed
- **Bỏ chế độ Tối**: xoá bộ chọn giao diện Hệ thống / Sáng / Tối ở sidebar BTC Hub và menu tài khoản; web cố định giao diện sáng (máy đặt chế độ Tối cũng hiện sáng), lựa chọn cũ lưu trên máy được xoá.
- **Bốc thăm** hỏi xác nhận trước khi bốc; **Bốc thăm lại** cảnh báo số trận đã xếp lịch sẽ mất lịch.
- **Xếp lịch** báo thêm số lượt VĐV không được nghỉ (đánh 2 khung giờ liền nhau); kết quả API có `noRest`.
- **Điều phối sân**: hỏi lại khi gọi trận trước giờ khai mạc và khi rút về trận đã có điểm; hộp Chuyển sân làm mờ sân hiện tại / sân đang có trận.
- **Trận đấu & trọng tài**: thêm bộ lọc **Mời ra sân**.
- **Thanh điều hướng**: "Lịch thi đấu ▾" mở danh sách giải để chọn (đang diễn ra → sắp diễn ra → nháp → đã kết thúc), khỏi phải cuộn trang chủ. Mục **"Trọng tài" chỉ hiện với tài khoản có nhiệm vụ trọng tài** (vai trò trọng tài của giải, phụ trách sân, hoặc được gán trận); admin không còn thấy mục này.
- **Menu tài khoản gom phần quản lý**: danh sách giải mình quản lý được (admin: mọi giải; BTC: giải mình là BTC) dẫn vào trang quản trị, "Tạo giải mới" (admin), "Quản lý tài khoản" (admin) hoặc "Đổi mật khẩu", chọn giao diện, đăng xuất. Bỏ mục "Tạo giải" khỏi thanh trên.
- Điện thoại: thanh tab đáy Trang chủ · Lịch đấu (mở bảng chọn giải) · Trọng tài.
- Trang chủ: banner gọn hơn, danh sách giải lên ngay dưới banner (trước phần giới thiệu tính năng), cùng thứ tự với bảng chọn giải.
- Bỏ bộ chọn giao diện ở chân trang và ở trang Tài khoản (đã có trong menu tài khoản).
- `GET /tournaments` trả thêm `my_role` (`organizer` | `referee` | `null`) và `is_referee` theo người xem.

### Fixed
- **Nhập Excel bỏ qua nhầm người "trùng"**: trước đây người ở tab này bị so với mọi tab khác cùng vào một nội dung (vd "ĐƠN NAM A" và "ĐƠN NAM B" gộp vào "Đơn nam") rồi âm thầm "đã đăng ký — bỏ qua". Nay trùng trong file **chỉ xét trong cùng tab**; trùng ở tab khác → báo lỗi chỉ rõ tab + dòng. Người đã có trên hệ thống vẫn tự bỏ qua như cũ.

### Added
- **Biên bản diễn biến điểm dưới Bàn điểm** theo mẫu biên bản giấy: mỗi pha cầu một cột, số ghi ở hàng người giao pha kế tiếp, G/N đầu game, vạch "Nghỉ" / "Đổi sân", ✎ khi sửa người giao hoặc BTC sửa tay, ⏳ cho pha chưa lưu (mất mạng). Trang chỉ xem `/bien-ban/<matchId>` (công khai, tự làm mới) có **In / Tải PDF** khổ A4 ngang; nút **Biên bản** ở trang Trận đấu & trọng tài và trên thẻ trận công khai.
- **Chọn người giao và người nhận khi đánh đôi**: đầu mỗi game chọn đội giao → ai giao → ai nhận; máy tự tính vị trí trái/phải và người giao mọi pha sau theo luật BWF; nhãn giao/nhận kèm tên; **Sửa người giao** chọn đúng VĐV.
- API biên bản: `POST /matches/:id/rallies`, `DELETE /matches/:id/rallies/last`, `GET /matches/:id` trả thêm `rallies`. **Migration 010** (`match_rallies`; nhật ký thêm sửa người giao / hoàn tác pha cầu / xác nhận kết quả).
- **Xoá giải**: mục "Vùng nguy hiểm" cuối trang Tổng quan (quản trị viên hoặc người tạo giải), gõ lại đường dẫn để xác nhận, không xoá được giải đang diễn ra. Xoá mềm — **khôi phục trong 7 ngày** ở trang chủ (mục "Giải đã xoá"), quá hạn máy chủ xoá hẳn toàn bộ dữ liệu của giải. API `DELETE /tournaments/:id`, `POST /tournaments/:id/restore`, `GET /deleted-tournaments`; **migration 011** (`tournaments.deleted_at`, `deleted_by`).
- **Sửa thông tin giải** ở trang Tổng quan: tên, đường dẫn (slug), địa điểm, giờ bắt đầu, số sân, phút/trận; đổi số sân / phút mỗi trận thì hỏi có xếp lại lịch các trận chưa đánh không. `PATCH /tournaments/:id` nhận thêm `slug`.
- **Nhập Excel — Tạo nội dung còn thiếu**: file chia hạng (Bảng A / B…) mà giải chưa có nội dung theo hạng → hộp xem trước liệt kê các nội dung Nội dung × Hạng (vd "Đơn nam A", mã MSA) kèm số dòng; một nút tạo hết (chép luật điểm, số bảng của nội dung gốc) và file tự xếp lại theo nội dung mới.
- **Nhập Excel — cột Ghi chú**: dòng có ghi chú chứa "sai", "chưa", "nợ", "chuyển" (không phân biệt dấu, nguyên từ) được gắn **Cần kiểm tra**; BTC tick dòng nào mới nhập dòng đó.
- **Nhập Excel — tiến độ & nhanh hơn**: các nội dung không chung VĐV được nhập song song (tối đa 4 cùng lúc; VĐV đánh nhiều nội dung vẫn nhập lần lượt để không tạo trùng hồ sơ), hiện "Đã nhập k/n nội dung…". Bảng tổng hợp có thêm số **VĐV đánh nhiều nội dung**.
- **Bảng tổng hợp khi nhập Excel / CSV**: đầu hộp xem trước có các ô **Hợp lệ** (đội sẽ nhập) · **Có lỗi** · **Cần xác nhận** (trùng tên) · **Trùng** (đã có trên hệ thống hoặc lặp lại trong cùng tab → bỏ qua), bảng **phân loại theo nội dung** (hợp lệ / lỗi / trùng từng nội dung; lỗi không xác định được nội dung gom vào dòng riêng), và danh sách dòng lỗi cần xử lý ngay bên dưới.
- **Trùng tên khi nhập VĐV**: người không có MSSV/SĐT trùng tên người khác và **khác CLB** → hộp xem trước hỏi **Người khác** (mặc định) / **Cùng người**; chọn "người khác" thì server tạo hồ sơ riêng (`player1NewAthlete` / `player2NewAthlete`) thay vì báo "đã đăng ký". Nhiều hồ sơ cùng tên mà đúng 1 người cùng CLB → tự nhận đúng người đó.
- **Nhập Excel không còn dừng giữa chừng**: mỗi nội dung ghi độc lập; nội dung lỗi được báo riêng (giữ hộp xem trước, đội đã vào tự bỏ qua khi nhập lại), các nội dung khác vẫn vào. Email sai định dạng bị bỏ qua kèm cảnh báo thay vì làm hỏng cả nội dung (cả ở client lẫn server).
- **Dán danh sách** nhận thêm MSSV và SĐT: `tên ; CLB ; MSSV ; SĐT` (đôi: `A / B ; CLB ; MSSV A / MSSV B ; SĐT A / SĐT B`).
- **Kết quả tìm VĐV gọn hơn**: danh sách chỉ còn thẻ nhỏ (họ tên + các nội dung; trùng tên thì kèm CLB); bấm → trang cuộn mượt tới **khung chi tiết** riêng dưới danh sách (trận tới, từng nội dung, từng trận), có nút đóng, nhận focus bàn phím. Tìm từ khoá khác ra đúng 1 người thì khung tự mở lại (trước đây đóng một lần là không tự mở nữa). Ô tìm chỉ còn 1 dấu ✕ (ẩn nút xoá mặc định của trình duyệt); nhãn "Sân N" và tiêu đề bảng lịch không còn xuống dòng.
- **Thẻ kết quả tìm VĐV** (thiết kế lại ô tìm): mỗi VĐV một thẻ gộp mọi nội dung (CLB, nội dung + bảng, trận tới); bấm để xem từng trận (giờ, sân, vòng, đối thủ, tỉ số, Thắng/Thua theo góc nhìn VĐV). Ưu tiên khớp tên, chỉ hiện theo CLB / trường khi không ai khớp tên (có nhãn). Từ khoá có dấu so khớp đúng dấu ("bằng" không còn khớp "Bàng"); không ai đúng dấu thì hiện kết quả bỏ dấu kèm thông báo.
- **Phân biệt VĐV trùng tên trên trang công khai**: API trận / bảng xếp hạng trả thêm `players: [{athleteId, name}]` (chỉ mã hồ sơ, không MSSV/SĐT) → hai người trùng tên khác MSSV là hai thẻ riêng, gắn nhãn "trùng tên — xem CLB".
- **BTC tự quản lý tài khoản trọng tài** (Quản trị › Ban tổ chức, `GET/POST /tournaments/:id/referees`, `PATCH/DELETE /tournaments/:id/referees/:userId`, migration `008_referee_accounts`): tạo tài khoản (tên đăng nhập gợi ý từ họ tên, mật khẩu ngẫu nhiên, hiện một lần kèm nút sao chép), đổi tên, đặt lại mật khẩu, khoá / mở khoá, gỡ khỏi giải (khoá tài khoản nếu không còn làm giải nào). BTC không sửa được tài khoản đang làm ở giải của BTC khác; ghi nhật ký, không ghi mật khẩu.
- **Ô tìm VĐV** trên tab Lịch thi đấu và Bảng đấu: gõ tên (không dấu cũng được) hoặc CLB → lịch chỉ còn trận của người đó, bảng đấu chỉ còn bảng có tên họ (dòng tô vàng), ô tóm tắt "MS Bảng C · hạng 3". Giữ `?q=` khi chuyển tab, chia sẻ được. Tab Bảng đấu mặc định hiện mọi nội dung đã bốc thăm (có nút "Tất cả nội dung").
- **Nhập file đăng ký dạng Google Sheets của BTC**: sheet câu trả lời Form có rẽ nhánh (nhiều cột "nội dung", MSSV đồng đội không ghi "partner"), cột **"Đăng kí bảng đấu" = hạng** (Bảng A / Bảng B → nội dung "Đôi nam A" / "Đôi nam B"; giải không chia hạng thì gộp và báo), và **mỗi nội dung một sheet** (tên sheet "ĐÔI NAM A", đôi = 2 dòng cùng STT "ĐỘI n"). Bản xem trước cho **chọn sheet** (mặc định chỉ sheet theo nội dung); bỏ qua cột link minh chứng / chuyển khoản.
- **Luật điểm theo vòng** (migration `007_round_rules`, `PUT /categories/:id/round-rules`): vòng bảng, mọi vòng loại trực tiếp, và từng vòng (tứ kết / bán kết / chung kết… đếm ngược từ chung kết, đặt được trước khi có nhánh); điểm 21/15/11 hoặc tuỳ chỉnh, 1 game / 2/3 / 3/5. Khoá theo từng trận đã bắt đầu (`RULES_LOCKED`). Bàn điểm, kiểm tra tỉ số và trang công khai dùng luật của vòng.
- **Bàn điểm: bên giao cầu & ô giao** (bên thắng pha giao tiếp; điểm chẵn → ô phải, lẻ → ô trái), hoàn tác trả lại bên giao, nút sửa bên giao.
- **Nhắc nghỉ & đổi sân**: nghỉ 60 s khi bên dẫn chạm nửa số điểm (11/8/6), nghỉ 2 phút + đổi sân giữa game, đổi sân ở game quyết định; đếm ngược, rung máy, tự đổi bên trên màn hình.
- **Giao diện Hệ thống / Sáng / Tối** (menu tài khoản, sidebar quản trị), lưu theo từng máy, không loé trắng khi tải trang. Khán giả chưa đăng nhập theo cài đặt của máy.
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
- Khớp nội dung theo tên chặt hơn: "Đôi nam nữ" không còn rơi vào "Đôi nam" khi giải chưa có nội dung đôi nam nữ.
- Sửa: trang quản trị cuộn cả trang và sidebar trôi khỏi màn hình (nhãn ẩn `sr-only` thoát khỏi vùng cuộn) — để lại khoảng trống tối dưới chân trang.
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
