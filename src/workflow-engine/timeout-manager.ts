import type { RunId, StageId } from './types.js';

type TimeoutCallback = (runId: RunId, stageId: StageId) => void;

export class TimeoutManager {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  private static key(runId: RunId, stageId: StageId): string {
    return `${runId}::${stageId}`;
  }

  static parseDuration(duration: string): number {
    let totalMs = 0;
    const hourMatch = duration.match(/(\d+)h/);
    const minMatch = duration.match(/(\d+)m/);
    const secMatch = duration.match(/(\d+)s/);

    if (hourMatch) totalMs += parseInt(hourMatch[1], 10) * 3_600_000;
    if (minMatch) totalMs += parseInt(minMatch[1], 10) * 60_000;
    if (secMatch) totalMs += parseInt(secMatch[1], 10) * 1_000;

    if (totalMs === 0) {
      throw new Error(`Invalid duration: ${duration}. Use format like '15m', '1h', '30s', '2h30m'.`);
    }
    return totalMs;
  }

  startTimer(runId: RunId, stageId: StageId, duration: string, onTimeout: TimeoutCallback): void {
    const key = TimeoutManager.key(runId, stageId);
    this.cancelTimer(runId, stageId);

    const ms = TimeoutManager.parseDuration(duration);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      onTimeout(runId, stageId);
    }, ms);

    this.timers.set(key, timer);
  }

  cancelTimer(runId: RunId, stageId: StageId): void {
    const key = TimeoutManager.key(runId, stageId);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  cancelAllForRun(runId: RunId): void {
    for (const [key, timer] of this.timers) {
      if (key.startsWith(`${runId}::`)) {
        clearTimeout(timer);
        this.timers.delete(key);
      }
    }
  }

  activeTimerCount(): number {
    return this.timers.size;
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
