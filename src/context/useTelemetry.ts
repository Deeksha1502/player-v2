/**
 * Custom Hook - useTelemetry
 *
 * Centralizes all telemetry logging in one place. Question components and
 * orchestrators use this hook instead of calling telemetry-service directly.
 * This makes telemetry consistent, testable, and easy to modify globally.
 */

import { useCallback } from 'react';
import {
  raiseInteractEvent,
  raiseAssessEvent,
  raiseImpressionEvent,
  raiseStartEvent,
  raiseEndEvent,
  raiseSummaryEvent,
  raiseErrorEvent,
  raiseResponseEvent,
} from '../services/telemetry-service';

export function useTelemetry() {
  /** Log when a user selects an option/answer. */
  const logOptionSelected = useCallback((questionId: string, answer: string | string[]) => {
    raiseInteractEvent({
      type: 'CHOOSE',
      id: Array.isArray(answer) ? answer.join(',') : String(answer),
      questionId,
    });
  }, []);

  /**
   * Log when an answer is scored/submitted.
   *
   * Angular parity (viewer-service.ts:raiseAssesEvent, called from
   * section-player.component.ts with `edataItem`/`currentIndex+1`/`pass`/
   * `resvalues`/`slideDuration`) — the real Sunbird ASSESS `edata` shape is
   * `{ item, index, pass, score, resvalues, duration }`, NOT an arbitrary
   * custom shape: the legacy telemetry-sdk passes `data` straight through as
   * `edata` with no reshaping, so whatever we send here IS the wire payload
   * that progress/scoring processing reads.
   *
   * `item` is intentionally a reduced version of Angular's `edataItem`
   * (id/type/maxscore only, no title/desc/params) — those extra fields are
   * descriptive metadata only; id+type+maxscore+score+pass+index carry the
   * signal progress/scoring actually needs. `duration` defaults to 0 — this
   * project doesn't yet track per-question view duration (Angular's
   * `slideDuration`); revisit if that field turns out to matter downstream.
   */
  const logAnswerSubmitted = useCallback(
    (
      question: { identifier: string; qType?: string; primaryCategory?: string },
      index: number,
      resvalues: unknown[],
      score: number,
      maxScore = 1,
    ) => {
      raiseAssessEvent({
        item: {
          id: question.identifier,
          type: (question.qType || question.primaryCategory || '').toLowerCase(),
          maxscore: maxScore,
        },
        index,
        pass: score >= maxScore ? 'Yes' : 'No',
        score,
        resvalues,
        duration: 0,
      });
    },
    [],
  );

  /** Log when a page/section is viewed. */
  const logPageViewed = useCallback((pageId: string) => {
    raiseImpressionEvent({ pageId });
  }, []);

  /** Log when the assessment actually begins (Angular parity: viewer-service raiseStartEvent). */
  const logAssessmentStart = useCallback((durationMs: number) => {
    raiseStartEvent({
      type: 'content',
      mode: 'play',
      pageid: '',
      duration: Number((durationMs / 1e3).toFixed(2)),
    });
  }, []);

  /** Log when the assessment is submitted (Angular parity: viewer-service raiseEndEvent). */
  const logAssessmentEnd = useCallback(
    (currentQuestionIndex: number, totalQuestions: number, durationMs: number) => {
      raiseEndEvent({
        type: 'content',
        mode: 'play',
        pageid: 'sunbird-player-Endpage',
        currentPage: currentQuestionIndex,
        totalPages: totalQuestions,
        duration: Number((durationMs / 1e3).toFixed(2)),
      });
    },
    [],
  );

  /** Log the final score/summary breakdown (Angular parity: viewer-service raiseSummaryEvent). */
  const logSummary = useCallback(
    (summary: { correct: number; wrong: number; partial: number; score: number }) => {
      raiseSummaryEvent({
        type: 'content',
        mode: 'play',
        interactions: summary.correct + summary.wrong + summary.partial,
        extra: [
          { id: 'score', value: summary.score.toString() },
          { id: 'correct', value: summary.correct.toString() },
          { id: 'incorrect', value: summary.wrong.toString() },
          { id: 'partial', value: summary.partial.toString() },
        ],
      });
    },
    [],
  );

  /** Log a player-level error. */
  const logError = useCallback((error: Error) => {
    raiseErrorEvent({
      err: 'LOAD',
      errtype: 'content',
      stacktrace: error?.toString() || '',
    });
  }, []);

  /**
   * Log the final response value for a question being LEFT via navigation.
   *
   * Angular parity (viewer-service.ts:raiseResponseEvent, called from
   * section-player.component.ts:346's nextSlide() — NOT from the option-select
   * handler). This fires once per question, when the learner navigates away
   * from it (Next/jump), using whatever was last selected — distinct from
   * ASSESS (fired immediately on answering) and INTERACT (fired on every
   * option click). `option` is undefined when the question was left
   * unanswered (Angular: `currentOptionSelected?.option ? ... : undefined`).
   */
  const logResponse = useCallback(
    (questionId: string, qType: string | undefined, option: unknown) => {
      raiseResponseEvent({
        target: { id: questionId, ver: '1.0', type: qType || '' },
        type: 'CHOOSE',
        values: [{ option }],
      });
    },
    [],
  );

  return {
    logOptionSelected,
    logAnswerSubmitted,
    logPageViewed,
    logAssessmentStart,
    logAssessmentEnd,
    logSummary,
    logError,
    logResponse,
  };
}
