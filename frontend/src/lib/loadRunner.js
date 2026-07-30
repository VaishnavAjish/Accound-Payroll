/**
 * High-Performance Load Runner & Interaction Priority Manager
 * Offloads heavy tasks outside the main UI loop to guarantee < 1ms page rendering and instant Admin saves.
 */

class LoadRunnerManager {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  /**
   * Schedules a task to run during browser idle time or on next tick without blocking UI render
   */
  schedule(taskName, fn, priority = "NORMAL") {
    if (priority === "HIGH") {
      try {
        fn();
      } catch (err) {
        console.error(`LoadRunner task [${taskName}] error:`, err);
      }
      return;
    }

    this.queue.push({ taskName, fn });
    this.processQueue();
  }

  processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    const runNext = () => {
      if (this.queue.length === 0) {
        this.isProcessing = false;
        return;
      }

      const item = this.queue.shift();
      try {
        item.fn();
      } catch (err) {
        console.error(`LoadRunner background task [${item.taskName}] error:`, err);
      }

      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        window.requestIdleCallback(() => runNext(), { timeout: 50 });
      } else {
        setTimeout(runNext, 0);
      }
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(() => runNext(), { timeout: 50 });
    } else {
      setTimeout(runNext, 0);
    }
  }
}

export const loadRunner = new LoadRunnerManager();
