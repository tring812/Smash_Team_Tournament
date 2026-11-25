/** Chỉ gộp GET đang chạy, không lưu kết quả hay dữ liệu phiên sau khi request hoàn tất. */
export function createSharedRead() {
  type Entry = { controller: AbortController; promise: Promise<unknown>; readers: number };
  const active = new Map<string, Entry>();
  return {
    clear() { active.clear(); },
    read<T>(key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Đã huỷ yêu cầu", "AbortError"));
      let entry = active.get(key);
      if (!entry) {
        const controller = new AbortController();
        entry = { controller, promise: Promise.resolve().then(() => load(controller.signal)), readers: 0 };
        active.set(key, entry);
        const created = entry;
        const remove = () => { if (active.get(key) === created) active.delete(key); };
        void entry.promise.then(remove, remove);
      }
      const shared = entry;
      shared.readers += 1;
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const release = () => {
          if (settled) return false;
          settled = true;
          signal?.removeEventListener("abort", abort);
          shared.readers -= 1;
          if (!shared.readers) {
            if (active.get(key) === shared) active.delete(key);
            shared.controller.abort();
          }
          return true;
        };
        const abort = () => {
          if (release()) reject(signal?.reason ?? new DOMException("Đã huỷ yêu cầu", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
        void shared.promise.then(
          (value) => {
            if (!release()) return;
            // Mỗi thành phần nhận bản JSON riêng, tránh sort/sửa mảng ảnh hưởng thành phần khác.
            try { resolve(structuredClone(value) as T); } catch (error) { reject(error); }
          },
          (error) => { if (release()) reject(error); },
        );
      });
    },
  };
}
