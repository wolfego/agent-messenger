import { describe, it, expect, vi, afterEach } from 'vitest';
import { TimeoutManager } from '../../src/workflow-engine/timeout-manager.js';

describe('TimeoutManager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses duration strings correctly', () => {
    expect(TimeoutManager.parseDuration('15m')).toBe(15 * 60 * 1000);
    expect(TimeoutManager.parseDuration('1h')).toBe(60 * 60 * 1000);
    expect(TimeoutManager.parseDuration('30s')).toBe(30 * 1000);
    expect(TimeoutManager.parseDuration('2h30m')).toBe(150 * 60 * 1000);
  });

  it('calls onTimeout callback when timer expires', () => {
    vi.useFakeTimers();
    const manager = new TimeoutManager();
    const callback = vi.fn();

    manager.startTimer('run-1', 'stage-1', '1s', callback);
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledWith('run-1', 'stage-1');

    vi.useRealTimers();
  });

  it('cancels timer before expiry', () => {
    vi.useFakeTimers();
    const manager = new TimeoutManager();
    const callback = vi.fn();

    manager.startTimer('run-1', 'stage-1', '5s', callback);
    manager.cancelTimer('run-1', 'stage-1');
    vi.advanceTimersByTime(6000);
    expect(callback).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('tracks active timers', () => {
    vi.useFakeTimers();
    const manager = new TimeoutManager();

    manager.startTimer('run-1', 'stage-1', '10m', vi.fn());
    manager.startTimer('run-1', 'stage-2', '5m', vi.fn());
    expect(manager.activeTimerCount()).toBe(2);

    manager.cancelTimer('run-1', 'stage-1');
    expect(manager.activeTimerCount()).toBe(1);

    vi.useRealTimers();
  });

  it('cancelAllForRun removes all timers for a run', () => {
    vi.useFakeTimers();
    const manager = new TimeoutManager();

    manager.startTimer('run-1', 'stage-1', '10m', vi.fn());
    manager.startTimer('run-1', 'stage-2', '5m', vi.fn());
    manager.startTimer('run-2', 'stage-1', '5m', vi.fn());

    manager.cancelAllForRun('run-1');
    expect(manager.activeTimerCount()).toBe(1);

    vi.useRealTimers();
  });
});
