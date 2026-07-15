import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTelemetry } from './useTelemetry';
import { getQueuedEvents, clearEventQueue } from '../services/telemetry-service';

describe('useTelemetry', () => {
  beforeEach(() => {
    clearEventQueue();
  });

  it('logOptionSelected queues an INTERACT event (string answer)', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logOptionSelected('q1', 'A'));

    const events = getQueuedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eid).toBe('INTERACT');
    expect(events[0].edata).toMatchObject({ type: 'CHOOSE', id: 'A', questionId: 'q1' });
  });

  it('logOptionSelected joins array answers', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logOptionSelected('q2', ['A', 'B']));

    const events = getQueuedEvents();
    expect(events[0].edata).toMatchObject({ id: 'A,B', questionId: 'q2' });
  });

  it('logAnswerSubmitted queues an ASSESS event matching the Sunbird item/index/pass/resvalues shape', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() =>
      result.current.logAnswerSubmitted({ identifier: 'q3', qType: 'MCQ' }, 1, ['A'], 1, 2),
    );

    const events = getQueuedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eid).toBe('ASSESS');
    expect(events[0].edata).toMatchObject({
      item: { id: 'q3', type: 'mcq', maxscore: 2 },
      index: 1,
      pass: 'No',
      score: 1,
      resvalues: ['A'],
      duration: 0,
    });
  });

  it('logAnswerSubmitted marks pass:"Yes" when score meets maxScore', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logAnswerSubmitted({ identifier: 'q4', qType: 'MCQ' }, 2, ['B'], 2, 2));

    const events = getQueuedEvents();
    expect(events[0].edata).toMatchObject({ pass: 'Yes', score: 2 });
  });

  it('logPageViewed queues an IMPRESSION event', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logPageViewed('start'));

    const events = getQueuedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eid).toBe('IMPRESSION');
    expect(events[0].edata).toMatchObject({ pageId: 'start' });
  });

  it('logAssessmentStart queues a START event with duration in seconds', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logAssessmentStart(1500));

    const events = getQueuedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eid).toBe('START');
    expect(events[0].edata).toMatchObject({ type: 'content', mode: 'play', duration: 1.5 });
  });

  it('logAssessmentEnd queues an END event with page/duration info', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logAssessmentEnd(3, 5, 2000));

    const events = getQueuedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eid).toBe('END');
    expect(events[0].edata).toMatchObject({
      currentPage: 3,
      totalPages: 5,
      duration: 2,
    });
  });

  it('logSummary queues a SUMMARY event with the correct/incorrect/partial/score breakdown', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logSummary({ correct: 2, wrong: 1, partial: 0, score: 2 }));

    const events = getQueuedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eid).toBe('SUMMARY');
    expect(events[0].edata).toMatchObject({
      interactions: 3,
      extra: [
        { id: 'score', value: '2' },
        { id: 'correct', value: '2' },
        { id: 'incorrect', value: '1' },
        { id: 'partial', value: '0' },
      ],
    });
  });

  it('logError queues an ERROR event', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logError(new Error('boom')));

    const events = getQueuedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eid).toBe('ERROR');
    expect(events[0].edata).toMatchObject({ err: 'LOAD', errtype: 'content' });
  });
});
