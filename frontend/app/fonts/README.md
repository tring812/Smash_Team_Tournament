# Font tự phục vụ cho Red Line

Giữ Inter biến thiên (độ đậm 100–900, cỡ quang học cố định 14) và Barlow Condensed 700/800 đứng/nghiêng.
Mỗi tệp WOFF2 gộp Latin cơ bản và tiếng Việt (kể cả dấu tổ hợp nếu font gốc có), dấu câu và ký hiệu thường dùng.
Ký tự ngoài tập này dùng font dự phòng của hệ điều hành. Không dùng các font này cho ngôn ngữ khác mà chưa kiểm tra độ phủ.

Trước đây các dải Unicode của Google Fonts chồng nhau: một số chữ tiếng Việt có thể kéo thêm cả tệp
Latin mở rộng Inter khoảng 85 KB và các tệp Barlow tương ứng. Các bản gộp không cần tải thêm dải này.
`next/font/local` tạo preload trực tiếp trong HTML, tự phục vụ cùng tên miền, giữ `font-display: swap`
và font dự phòng để chữ không phải chờ font. Giữ metric Arial dự phòng của bản trước để hạn chế
thay đổi bố cục khi chuyển font. Không cần tải font từ Google lúc build.

## Nguồn và giấy phép

Nguồn: kho [google/fonts](https://github.com/google/fonts), thư mục `ofl/inter` và `ofl/barlowcondensed`.
Giữ giấy phép SIL Open Font License trong `Inter-OFL.txt` và `BarlowCondensed-OFL.txt`.
Các WOFF2 là bản rút gọn để nhúng vào ứng dụng; không cài làm font hệ thống.

## Tạo lại

Tải các tệp gốc về một thư mục riêng (không commit TTF):

- `ofl/inter/Inter[opsz,wght].ttf` → `Inter.ttf`
- `ofl/barlowcondensed/BarlowCondensed-Bold.ttf`
- `ofl/barlowcondensed/BarlowCondensed-ExtraBold.ttf`
- `ofl/barlowcondensed/BarlowCondensed-BoldItalic.ttf`
- `ofl/barlowcondensed/BarlowCondensed-ExtraBoldItalic.ttf`

Từ thư mục gốc repo, chạy:

```powershell
uv run --with fonttools==4.61.1 --with brotli==1.2.0 python frontend/scripts/subset-fonts.py <thu-muc-TTF>
```

Công cụ này chỉ dùng khi cập nhật font, không phải dependency hay bước build của web.
Script kiểm tra toàn bộ chữ tiếng Việt dựng sẵn và tám dấu tổ hợp NFD ở cả font gốc và bản nén;
giữ thời gian sửa đổi của nguồn để chạy lại cho kết quả giống nhau. Tổng năm tệp hiện khoảng 131 KB (128 KiB).
Sau cập nhật, chạy test `frontend/test/fontLoading.test.mjs`, typecheck, lint và build; kiểm tra giao diện
trên desktop/điện thoại và đo lại Lighthouse. Dung lượng giảm không phải số đo cải thiện LCP thực tế.
