# Changelog

Theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/).

## [Unreleased]

### Fixed
- **Biên bản cộng set cho người thắng game**: game đã xong có thêm cột **Set** cuối khối (số set mỗi bên đã thắng tới hết game đó, bên thắng được +1, tô xanh) và tiêu đề khối ghi "… thắng game"; đầu trang Biên bản ghi **Set 1–0** kèm điểm từng game thay vì chỉ điểm. Bỏ nhãn **G** / **N** cạnh tên VĐV (người giao / nhận đầu game vẫn thấy qua số 0 ở cột đầu).
- CI chạy các bài kiểm thử frontend, gồm tương thích API bảng đấu, để tránh tái phát lỗi “API không tồn tại”.
- Bảng đấu và tìm VĐV tự dùng API bảng xếp hạng từng nội dung khi máy chủ chưa hỗ trợ API tổng hợp, thay vì hiện “API không tồn tại”. Vẫn ưu tiên một request trên máy chủ mới; không che lỗi quyền hoặc lỗi dữ liệu.
- Tạm hoàn tác bản tối ưu font khi điều tra lỗi bảng đấu; phần font được áp dụng lại sau khi bổ sung tương thích API bảng xếp hạng, không thay đổi API hoặc dữ liệu.
- Khi chọn người giao đầu tiên tự chuyển giải sang đang diễn ra, các màn hình khác cập nhật trạng thái giải ngay qua kênh trực tiếp; các điểm tiếp theo vẫn chỉ tải lại trận bị đổi.
- **Tài khoản trọng tài tạo ở trang Tài khoản phân công được ngay**: trước đây tài khoản tạo ở đây chưa thuộc giải nào nên không hiện trong ô phân công trọng tài của trận / sân (máy chủ cũng từ chối). Nay hộp **Tạo tài khoản** có mục **Làm trọng tài giải** (chọn một hoặc nhiều giải chưa kết thúc) — tạo tài khoản và thêm vào giải trong cùng một giao dịch, ghi nhật ký giải. Ô phân công gom theo *Trọng tài* / *Ban tổ chức* và nhắc đường thêm trọng tài khi giải chưa có ai. `POST /admin/users` nhận thêm `refereeTournamentIds` (lỗi mới `422 TOURNAMENT_NOT_FOUND`), trả thêm `refereeTournamentIds`.
- **Gõ chữ trong hộp thoại không còn bị nhảy ô** (vd Tạo tài khoản, Tạo tài khoản trọng tài, Sửa VĐV, Sửa nội dung): trước đây mỗi phím gõ làm hộp thoại đặt lại focus về ô đầu tiên, nên chữ gõ ở ô Tên đăng nhập / Mật khẩu nhảy sang ô Họ tên và bộ gõ tiếng Việt bị ngắt giữa chừng. Nay focus chỉ đặt một lần khi mở hộp thoại.
- **Bảng điểm không còn lùi về tỉ số cũ** khi có điểm liên tục: trước đây mỗi lần tải lại (do có thay đổi trực tiếp hoặc tới chu kỳ làm mới) chạy song song với lần trước, response về sau cùng thắng nên trang công khai / màn hình TV / điều phối sân đôi khi hiện tỉ số cũ trong giây lát. Nay lần tải mới huỷ lần tải còn dở và chỉ kết quả mới nhất được hiển thị.
- **Phục hồi trận không còn nhận trùng sân/VĐV**: mở lại trận và huỷ truất quyền kiểm tra sân, VĐV đang bận (kể cả khác nội dung) trước khi chấp nhận trạng thái chiếm sân. Nếu có xung đột, toàn bộ thao tác bị huỷ với `409 COURT_BUSY` / `PLAYER_BUSY`; BTC giải phóng sân/VĐV rồi thử lại. Không đổi endpoint, không cần migration mới.
- **Sửa đội không còn cho phép trùng VĐV trong cùng nội dung**: `PATCH /entries/:id` từ chối với `409 ATHLETE_ALREADY_ENTERED` nếu một trong hai VĐV đã thuộc đội khác, tránh sinh trận VĐV đấu với chính mình. Vẫn cho phép đảo thứ tự thành viên trong cùng đội và tham gia nhiều nội dung; thao tác bị từ chối không để lại thay đổi hồ sơ hoặc nhật ký.
- **Không nhận trùng sân/VĐV khi ghi điểm trực tiếp**: thao tác chọn người giao hoặc ghi điểm đầu tiên kiểm tra sân (nếu có) và VĐV rảnh trước khi chuyển trận sang `live`; xung đột báo `COURT_BUSY` / `PLAYER_BUSY`, không ghi dữ liệu một phần. Giữ bước xác nhận kết quả để cập nhật bảng/nhánh và giải phóng sân.
- **Bàn điểm sau khi xác nhận** hiện tỉ số cuối (vd 21–0) thay vì 0–0, và giữ biên bản để xem.
- **Bàn điểm khoá khi giải "Đã kết thúc"**: trước đây máy chủ từ chối nhưng giao diện vẫn cho chọn bên giao và bấm điểm, số điểm hiện lên rồi giữ nguyên. Nay hiện banner "Giải đã kết thúc — khoá nhập điểm" và làm mờ mọi nút; thao tác bị máy chủ từ chối thì **trả điểm về như trước**. Mọi API trả trận có thêm `tournamentStatus`.
- **Gọi vào sân không còn ghi đè giờ / sân dự kiến**: trước đây bấm "Gọi vào sân" đổi giờ dự kiến thành giờ gọi (vd 18:00 → 17:27), rút về thì trận mang giờ mới và sân cũ nên bị đẩy lên đầu hàng chờ. Nay giờ gọi lưu riêng (`called_at`), sân dự kiến cất ở cột mới `planned_court`; **Rút về** trả lại đúng giờ và sân dự kiến. **Migration 009** thêm cột và sửa lại các trận đã bị ghi đè (lấy giờ / sân dự kiến từ nhật ký gọi trận).

### Changed
- Thanh điều hướng desktop có nền trượt giữa các mục như Lịch thi đấu và Trọng tài; tắt chuyển động khi thiết bị bật chế độ giảm chuyển động.
- Trang tổng quan quản trị dùng banner Athlonix cho tiến độ, thẻ số liệu nền sáng và lối tắt điều hành. Giữ nguyên quyền và thao tác quản lý giải.
- Làm mới trang chủ Red Line theo bố cục Athlonix: banner chia đôi, dải sáng/tối xen kẽ, giải nổi bật, bộ lọc trạng thái và mục hỏi đáp. Giữ nền sáng cho dữ liệu thi đấu và biểu mẫu.
- Áp dụng lại font Inter/Barlow tự phục vụ bằng WOFF2 gộp Latin/tiếng Việt, preload từ HTML và giữ độ đậm, chữ nghiêng, font dự phòng. Build không còn cần tải font từ Google; giữ nguyên bản sửa lỗi bảng đấu.
- **Tìm VĐV nhanh hơn, bấm 1 lần ra hồ sơ VĐV**: chọn tên trong danh sách → hồ sơ gồm **mọi trận** của VĐV (không chỉ trận tới) và **bảng đấu** của họ ngay bên cạnh, giống nhau ở tab Lịch thi đấu và Bảng đấu (trước: tab Bảng đấu chỉ có trận tới). Chọn tên / gõ chữ không còn gọi lại máy chủ Next mỗi lần đổi `?q=` / `?p=` (`history.replaceState` thay `router.replace`), nên hồ sơ hiện ngay; chạm vào ô tìm là tải sẵn lịch + bảng xếp hạng. **Xoá hết chữ** trong ô tìm (không chỉ nút ✕) về ngay lịch / bảng chung.
- **Tìm VĐV (khách) theo 2 bước** ở Lịch thi đấu và Bảng đấu: gõ tên → **chỉ hiện danh sách tên** (họ tên, CLB, nội dung) để VĐV chọn đúng mình, lịch / bảng chung tạm ẩn; bấm chọn → **chỉ còn lịch thi đấu** (giờ, sân, đối thủ, tỉ số, trận tới, bảng + hạng) **hoặc chỉ các bảng** của VĐV đó. Trước đây vừa gõ đã hiện lịch của người khớp ngay trong khung tìm, bên dưới vẫn là lịch chung của cả giải. VĐV đã chọn nằm trên URL (`?p=`) nên giữ nguyên khi chuyển tab và chia sẻ được.
- Trang giải / TV / điều phối sân không còn tải cả lịch + bảng xếp hạng **hai lần** khi vừa mở (đổi chu kỳ làm mới lúc kênh trực tiếp nối xong từng kích hoạt tải lại); tab Bảng đấu / Loại trực tiếp không tải cả lịch khi không tìm VĐV.
- **Trang giải tải nhanh hơn**: bảng xếp hạng mọi nội dung lấy trong **một** request `GET /tournaments/:id/standings` (trước: một request + một lần kiểm quyền cho mỗi nội dung). Chuyển qua lại Lịch thi đấu / Bảng đấu / Loại trực tiếp hiện ngay dữ liệu vừa xem rồi làm mới ngầm thay vì trang trắng chờ tải. Thanh điều hướng tải danh sách giải song song với thông tin đăng nhập và không tải lại mỗi lần chuyển trang (làm mới sau 30 giây, khi đổi tài khoản hoặc vừa tạo giải).
- **Thao tác BTC không còn chờ tải lại cả trang**: phân công trọng tài (trận và sân) đổi ngay trên màn hình, chỉ khoá đúng ô đang lưu (các ô khác chọn tiếp được), lỗi thì báo và trả về trạng thái thật. Gọi vào sân, rút về, chuyển sân chỉ tải lại bảng sân; dời trận ở trang Trận đấu chỉ thay đúng trận đó. Trước đây mỗi thao tác tải lại thông tin giải, toàn bộ danh sách trận và danh sách BTC, ô chọn nhảy về tên cũ 1–2 giây. Bốc thăm, xếp lịch, sửa đội, mở lại trận vẫn tải lại toàn bộ.
- **Màn hình trực tiếp tải ít hơn nữa**: gọi vào sân, rút về, dời trận và bắt đầu trận giờ chỉ làm trang giải / TV tải lại **đúng trận đó** (trước đây tải lại cả lịch tới 1.000 trận); xác nhận kết quả chỉ tải trận vừa xong, trận nhận đội thắng và bảng xếp hạng / nhánh của nội dung đó. Mỗi điểm, trang giải / TV gọi `GET /matches/:id?rallies=0` — không còn tải cả biên bản trận chỉ để bỏ đi (~1 KB thay vì vài chục KB cuối trận, bớt một truy vấn). Trang **Biên bản** cập nhật ngay theo kênh trực tiếp thay vì hỏi máy chủ mỗi 5 giây, và thôi tải lại khi trận đã xong. Sự kiện SSE có thêm `categoryIds`.
- **Mỗi điểm chỉ tải lại đúng trận đó**: trước đây mỗi pha cầu khiến mọi trang giải / màn hình TV đang mở tải lại toàn bộ lịch thi đấu (tới 1.000 trận) cùng bảng xếp hạng từng nội dung. Nay kênh trực tiếp báo kèm phạm vi: chỉ tỉ số / biên bản / trọng tài của một trận đổi → trang chỉ gọi `GET /matches/:id` cho trận đó; gọi sân, dời trận, xác nhận kết quả, bốc thăm… vẫn tải lại toàn bộ như cũ. Bảng điều phối sân vẫn tải lại với mọi thay đổi. `data` của sự kiện SSE `changed` đổi từ dấu thời gian sang `{"kind":"match","matchIds":[…]}` / `{"kind":"structure"}` (client cũ vẫn chạy: coi mọi sự kiện là thay đổi toàn bộ).
- **Kiểm tra quyền xem gọn hơn**: xem bảng xếp hạng / danh sách đội / nhánh đấu của một nội dung và mở trang giải khi đã đăng nhập chỉ cần 1 truy vấn kiểm quyền thay vì 2 (trang giải tải lại bảng xếp hạng của từng nội dung mỗi khi có điểm). Quy tắc quyền không đổi.
- **Bỏ bước Bắt đầu trận bắt buộc (vấn đề số 2)**: trọng tài chọn người giao rồi ghi điểm trực tiếp; không còn nút hay request `/start` trên Bàn điểm, không yêu cầu sân để mở ghi điểm. Nút cuối trận trở về **Xác nhận kết quả**. API `/matches/:id/start` chỉ giữ tương thích giao diện cũ; bỏ lỗi `MATCH_NOT_STARTED` trong luồng ghi điểm. Giữ migration 012 và nhật ký cũ, không cần migration mới; không gỡ bản sửa vấn đề 1 và 3.
- **Giảm tải khi xem và điều hành giải**: gộp các GET trùng đang chạy trong cùng tab, không lưu cache kết quả/phiên; huỷ request khi đổi trang hoặc bộ lọc, tránh polling chồng nhau và tải lại khi quay về tab. Tab ẩn không tải lại theo sự kiện SSE. Công cụ Excel chỉ tải khi mở mục Nhập / xuất; nhánh đấu và kết quả tìm VĐV tách thành phần tải theo nhu cầu.
- **Admin gọn và dễ điều hành hơn**: menu chia nhóm, thu gọn thanh bên trên máy tính; menu điện thoại hỗ trợ Esc và giữ focus. Tổng quan có tiến độ, sân trống, trận trên sân và lối tắt; cấu hình/thao tác nhạy cảm được thu gọn riêng. Điều phối sân có bộ lọc trạng thái kèm số lượng, không thay đổi nghiệp vụ nhận sân.
- **Giao diện Red Line**: nhận diện đỏ–đen–trắng, hoạ tiết ca-rô và vạch xuất phát xuyên suốt trang chủ, điều hướng, quản lý giải, lịch/bảng đấu, đăng nhập, bàn trọng tài và màn hình TV. Trang chủ có minh hoạ cầu lông bằng véc-tơ; vùng dữ liệu giữ nền sáng, trạng thái trận vẫn có nhãn chữ và màu riêng.
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
