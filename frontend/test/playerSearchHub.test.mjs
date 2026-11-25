/** Tìm VĐV trên trang giải: không gọi lại máy chủ Next mỗi lần đổi ?q= / ?p=, tải sẵn khi chạm ô tìm, một hồ sơ cho cả hai tab. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hub = readFileSync(new URL('../app/t/[slug]/TournamentHub.tsx', import.meta.url), 'utf8');
const results = readFileSync(new URL('../app/components/PlayerResults.tsx', import.meta.url), 'utf8');

test('URL tìm kiếm đổi bằng history.replaceState, không router.replace (router.replace tải lại RSC từ máy chủ)', () => {
  // Phải là null: truyền state của Next (có __NA) thì Next bỏ qua, useSearchParams không đổi → bấm tên không hiện hồ sơ.
  assert.match(hub, /window\.history\.replaceState\(null, "", /);
  assert.doesNotMatch(hub, /router\.replace\(/);
  assert.doesNotMatch(hub, /useRouter/);
});

test('chạm / rê chuột vào ô tìm là tải sẵn dữ liệu tìm kiếm', () => {
  assert.match(hub, /onFocus=\{\(\) => setWarm\(true\)\}/);
  assert.match(hub, /const searching = Boolean\(q\.trim\(\)\) \|\| Boolean\(pickKey\) \|\| warm;/);
});

test('xoá hết chữ trong ô tìm về ngay lịch / bảng chung (xoá cả ?q= và ?p=)', () => {
  assert.match(hub, /if \(!v\.trim\(\)\) replaceParams\(\{ q: "", p: "" \}\);/);
});

test('đã chọn VĐV: cùng một hồ sơ (mọi trận + bảng đấu) ở cả tab Lịch và Bảng đấu', () => {
  assert.match(hub, /<PlayerProfile p=\{picked\} standings=\{standings\} highlight=\{rowHit\} onClear=\{clearSearch\} \/>/);
  assert.doesNotMatch(hub, /PlayerSchedule|PlayerBadge/);
  assert.match(results, /export function PlayerProfile\(/);
  assert.match(results, /<StandingsTables groups=\{groups\} highlight=\{highlight\} single \/>/);
});
