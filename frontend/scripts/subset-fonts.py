"""Tạo WOFF2 Latin/tiếng Việt từ các TTF gốc; chỉ dùng khi cập nhật font, không chạy lúc build."""

import sys
from io import BytesIO
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

source = Path(sys.argv[1])
target = Path(__file__).resolve().parents[1] / "app" / "fonts"
target.mkdir(parents=True, exist_ok=True)

# Gộp Latin cơ bản và tiếng Việt; không kéo cả Latin mở rộng vào chỉ vì vài chữ trùng mã.
ranges = [(0x20, 0xFF), (0x0300, 0x036F), (0x1EA0, 0x1EF9), (0x2000, 0x206F),
          (0x2190, 0x2193)]
unicodes = {cp for start, end in ranges for cp in range(start, end + 1)}
unicodes.update([0x2122, 0x2212, 0x2215, 0xFEFF, 0xFFFD])
unicodes.update([0x0102, 0x0103, 0x0110, 0x0111, 0x0128, 0x0129, 0x0168, 0x0169,
                 0x01A0, 0x01A1, 0x01AF, 0x01B0, 0x20AB, 0x20AC])

for filename in ["Inter", "BarlowCondensed-Bold", "BarlowCondensed-ExtraBold",
                 "BarlowCondensed-BoldItalic", "BarlowCondensed-ExtraBoldItalic"]:
    font = TTFont(source / f"{filename}.ttf", recalcTimestamp=False)
    source_cmap = set(font.getBestCmap())
    if filename == "Inter":
        # Cố định cỡ quang học dùng cho giao diện, vẫn giữ trục độ đậm biến thiên.
        font = instantiateVariableFont(font, {"opsz": 14}, inplace=True)
        buffer = BytesIO()
        font.save(buffer)
        buffer.seek(0)
        font = TTFont(buffer, recalcTimestamp=False)
    options = subset.Options()
    options.flavor = "woff2"
    options.hinting = False
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    font.flavor = "woff2"
    output = target / f"{filename}-latin-vietnamese.woff2"
    font.save(output)
    # Kiểm tra toàn bộ chữ tiếng Việt dựng sẵn và các dấu dùng khi chuẩn hoá NFD.
    saved = TTFont(output)
    required = set(range(0x1EA0, 0x1EFA)) | {0x0102, 0x0103, 0x0110, 0x0111,
        0x0128, 0x0129, 0x0168, 0x0169, 0x01A0, 0x01A1, 0x01AF, 0x01B0,
        0x0300, 0x0301, 0x0302, 0x0303, 0x0306, 0x0309, 0x031B, 0x0323}
    assert required <= source_cmap, f"Font gốc thiếu chữ/dấu tiếng Việt: {filename}"
    assert required <= saved.getBestCmap().keys(), f"Bản rút gọn thiếu chữ/dấu tiếng Việt: {filename}"
    print(f"{output.name}: {output.stat().st_size} bytes")
