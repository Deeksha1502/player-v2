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

  it('logOptionSelected includes subtype/pageid (Angular parity: quml-library.service.ts interact())', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logOptionSelected('q1', 'A', 2));

    const events = getQueuedEvents();
    expect(events[0].edata).toMatchObject({ subtype: '', pageid: '2' });
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

  it('logAnswerSubmitted includes item.title/sectionId and the real duration (Angular parity: section-player.component.ts edataItem/slideDuration)', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() =>
      result.current.logAnswerSubmitted(
        { identifier: 'q5', qType: 'MCQ', name: 'What is 2+2?' },
        1,
        ['A'],
        1,
        1,
        { sectionId: 's1', durationSec: 3.5 },
      ),
    );

    const events = getQueuedEvents();
    expect(events[0].edata).toMatchObject({
      item: { id: 'q5', title: 'What is 2+2?', sectionId: 's1' },
      duration: 3.5,
    });
  });

  it('logPageViewed queues an IMPRESSION event', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logPageViewed('start'));

    const events = getQueuedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eid).toBe('IMPRESSION');
    expect(events[0].edata).toMatchObject({ pageId: 'start' });
  });

  it('logPageViewed includes type/subtype/uri/pageid (Angular parity: quml-library.service.ts impression())', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logPageViewed('question', 1));

    const events = getQueuedEvents();
    expect(events[0].edata).toMatchObject({ type: 'workflow', subtype: '', uri: '', pageid: '1' });
  });

  it('logAssessmentStart queues a START event with duration in seconds', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logAssessmentStart(1500));

    const events = getQueuedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eid).toBe('START');
    expect(events[0].edata).toMatchObject({ type: 'content', mode: 'play', duration: 1.5 });
  });

  it('logAssessmentEnd queues an END event with a summary array (Angular parity: consumed by the portal\'s calculateContentProgress)', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logAssessmentEnd(3, 5, 2000, 4));

    const events = getQueuedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eid).toBe('END');
    expect(events[0].edata).toMatchObject({
      pageid: 'sunbird-player-Endpage',
      summary: [
        { progress: 60 },
        { totalNoofQuestions: 5 },
        { visitedQuestions: 5 },
        { endpageseen: true },
        { score: 4 },
      ],
      duration: 2,
    });
  });

  it('logSummary queues a SUMMARY event with the correct/incorrect/partial/skipped/score breakdown', () => {
    const { result } = renderHook(() => useTelemetry());
    const starttime = Date.now() - 5000;
    act(() =>
      result.current.logSummary(
        { correct: 2, wrong: 1, partial: 0, skipped: 1, score: 2 },
        { currentQuestionIndex: 4, totalQuestions: 4, starttime },
      ),
    );

    const events = getQueuedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eid).toBe('SUMMARY');
    expect(events[0].edata).toMatchObject({
      starttime,
      interactions: 3,
      pageviews: 4,
      extra: [
        { id: 'progress', value: '100' },
        { id: 'endpageseen', value: 'true' },
        { id: 'score', value: '2' },
        { id: 'correct', value: '2' },
        { id: 'incorrect', value: '1' },
        { id: 'partial', value: '0' },
        { id: 'skipped', value: '1' },
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

  it('logResponse queues a RESPONSE event with target/values (Angular parity)', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logResponse('q1', 'MCQ', 0));

    const events = getQueuedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eid).toBe('RESPONSE');
    expect(events[0].edata).toMatchObject({
      target: { id: 'q1', ver: '1.0', type: 'MCQ' },
      type: 'CHOOSE',
      values: [{ option: 0 }],
    });
  });

  it('logResponse carries option:undefined when the question was left unanswered', () => {
    const { result } = renderHook(() => useTelemetry());
    act(() => result.current.logResponse('q2', 'MCQ', undefined));

    const events = getQueuedEvents();
    expect(events[0].edata).toMatchObject({ values: [{ option: undefined }] });
  });
});
