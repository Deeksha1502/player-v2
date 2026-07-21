import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  initializeTelemetry,
  raiseInteractEvent,
  raiseAssessEvent,
  flushPendingAssessEvents,
  cancelPendingAssessEvent,
  subscribeTelemetry,
  getQueuedEvents,
  clearEventQueue,
} from './telemetry-service';
import type { TelemetryContext } from '../types';

const ctx = {} as TelemetryContext;

afterEach(() => {
  delete (window as any).EkTelemetry;
  clearEventQueue();
  vi.restoreAllMocks();
});

describe('telemetry-service — SDK method guards', () => {
  it('does NOT throw when the host SDK has no logEvent (regression: reorder crash)', () => {
    // Host SDK exposes initialize but NOT logEvent — exactly the failing case.
    (window as any).EkTelemetry = { initialize: vi.fn() };
    initializeTelemetry(ctx);

    const received: unknown[] = [];
    const unsub = subscribeTelemetry((e) => received.push(e));

    // This is what every onOptionSelected (incl. reorder drag/hover/nudge) hits.
    expect(() => raiseInteractEvent({ a: 1 })).not.toThrow();
    // Host still receives the event via the bridge even though logEvent is absent.
    expect(received).toHaveLength(1);
    unsub();
  });

  it('does not throw when the SDK has no initialize', () => {
    (window as any).EkTelemetry = { logEvent: vi.fn() };
    expect(() => initializeTelemetry(ctx)).not.toThrow();
  });

  it('calls logEvent when the SDK provides one, and still emits', () => {
    const logEvent = vi.fn();
    (window as any).EkTelemetry = { initialize: vi.fn(), logEvent };
    initializeTelemetry(ctx);

    const received: unknown[] = [];
    const unsub = subscribeTelemetry((e) => received.push(e));
    raiseInteractEvent({ a: 1 });

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
    unsub();
  });

  it('does NOT queue when the SDK lacks logEvent (bridge handles it; no unbounded growth)', () => {
    (window as any).EkTelemetry = { initialize: vi.fn() }; // no logEvent
    initializeTelemetry(ctx);
    clearEventQueue();
    raiseInteractEvent({ a: 1 });
    raiseInteractEvent({ a: 2 });
    // Never queued — flushQueuedEvents could never drain it, so it must not grow.
    expect(getQueuedEvents()).toHaveLength(0);
  });

  it('queues while no SDK is present (for a later flush)', () => {
    delete (window as any).EkTelemetry;
    initializeTelemetry(ctx); // no SDK → telemetrySDK reset to null
    clearEventQueue();
    raiseInteractEvent({ a: 1 });
    expect(getQueuedEvents()).toHaveLength(1);
  });

  it('resets the SDK reference when re-init finds no SDK (no stale logEvent calls)', () => {
    const logEvent = vi.fn();
    (window as any).EkTelemetry = { initialize: vi.fn(), logEvent };
    initializeTelemetry(ctx);
    // SDK removed and re-initialized → stale reference must be cleared.
    delete (window as any).EkTelemetry;
    initializeTelemetry(ctx);
    raiseInteractEvent({ a: 1 });
    expect(logEvent).not.toHaveBeenCalled(); // would fire if the stale ref lingered
  });

  it('regression: bridge event includes ets (not just timestamp) — the portal accumulates raw ASSESS events into assessments[].events, and the backend\'s getUniqueQuestions dedupes multiple attempts at the same question by sorting on `ets`; without it every event defaults server-side to "now", making "keep the latest attempt" unreliable and able to pick an earlier wrong answer over the final correct one', () => {
    initializeTelemetry(ctx);
    const received: { ets?: number; timestamp?: number }[] = [];
    const unsub = subscribeTelemetry((e) => received.push(e));

    raiseInteractEvent({ a: 1 });

    expect(typeof received[0].ets).toBe('number');
    unsub();
  });
});

describe('telemetry-service — ASSESS debounce (FTB/MTF/SEQ/REO fire per keystroke/step)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initializeTelemetry(ctx);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces repeated calls for the same question, dispatching only the last value after 2s', () => {
    const received: { edata: unknown }[] = [];
    const unsub = subscribeTelemetry((e) => received.push(e as { edata: unknown }));

    raiseAssessEvent({ item: { id: 'q1' }, resvalues: [{ value: 'p' }] });
    raiseAssessEvent({ item: { id: 'q1' }, resvalues: [{ value: 'pa' }] });
    raiseAssessEvent({ item: { id: 'q1' }, resvalues: [{ value: 'paris' }] });
    expect(received).toHaveLength(0); // nothing dispatched yet

    vi.advanceTimersByTime(2000);
    expect(received).toHaveLength(1);
    expect(received[0].edata).toEqual({ item: { id: 'q1' }, resvalues: [{ value: 'paris' }] });
    unsub();
  });

  it('debounces two different questions independently', () => {
    const received: { edata: { item: { id: string } } }[] = [];
    const unsub = subscribeTelemetry((e) => received.push(e as { edata: { item: { id: string } } }));

    raiseAssessEvent({ item: { id: 'q1' }, resvalues: [{ value: 'a' }] });
    raiseAssessEvent({ item: { id: 'q2' }, resvalues: [{ value: 'b' }] });
    vi.advanceTimersByTime(2000);

    expect(received).toHaveLength(2);
    expect(received.map((e) => e.edata.item.id).sort()).toEqual(['q1', 'q2']);
    unsub();
  });

  it('flushPendingAssessEvents dispatches immediately, bypassing the timer', () => {
    const received: unknown[] = [];
    const unsub = subscribeTelemetry((e) => received.push(e));

    raiseAssessEvent({ item: { id: 'q1' }, resvalues: [{ value: 'paris' }] });
    expect(received).toHaveLength(0);

    flushPendingAssessEvents();
    expect(received).toHaveLength(1);

    // The timer that would have fired later must not double-dispatch.
    vi.advanceTimersByTime(2000);
    expect(received).toHaveLength(1);
    unsub();
  });

  it('cancelPendingAssessEvent drops a pending event with no dispatch (answer cleared to empty)', () => {
    const received: unknown[] = [];
    const unsub = subscribeTelemetry((e) => received.push(e));

    raiseAssessEvent({ item: { id: 'q1' }, resvalues: [{ value: 'paris' }] });
    cancelPendingAssessEvent('q1');
    vi.advanceTimersByTime(2000);

    expect(received).toHaveLength(0);
    unsub();
  });
});
