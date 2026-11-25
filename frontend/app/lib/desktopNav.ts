export type DesktopNavItem = "home" | "guide" | "faq" | "schedule" | "ref";

type Preview = { item: DesktopNavItem; pathname: string };

/** Cho bộ chọn giải đang mở ưu tiên; khi đổi trang thì bỏ trạng thái rê chuột của trang cũ. */
export function desktopNavHighlight(
  pathname: string,
  current: DesktopNavItem | null,
  scheduleOpen: boolean,
  preview: Preview | null,
  isReferee: boolean,
): DesktopNavItem | null {
  if (scheduleOpen) return "schedule";
  if (preview?.pathname === pathname && (preview.item !== "ref" || isReferee)) return preview.item;
  return current;
}
