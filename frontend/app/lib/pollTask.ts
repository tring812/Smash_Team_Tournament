/** Một lượt tải tại một thời điểm; các tín hiệu dồn lại chỉ tạo một lượt tải tiếp theo. */
export function createPollTask<T>(
  load: (signal: AbortSignal) => Promise<T>,
  onData: (data: T) => void,
  onError: (error: Error) => void,
) {
  let disposed = false;
  let pending: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let again = false;

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (pending) {
      again = true;
      return pending;
    }
    pending = (async () => {
      do {
        again = false;
        controller = new AbortController();
        try {
          const data = await load(controller.signal);
          if (!disposed && !controller.signal.aborted) onData(data);
        } catch (error) {
          if (!disposed && !controller.signal.aborted && (error as Error).name !== "AbortError") onError(error as Error);
        }
      } while (again && !disposed);
    })().finally(() => { pending = null; });
    return pending;
  }

  return {
    refresh,
    dispose() {
      disposed = true;
      again = false;
      controller?.abort();
    },
  };
}
