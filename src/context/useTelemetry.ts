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
  /**
   * Log a generic named interaction (Angular parity: viewer-service.ts's
   * raiseHeartBeatEvent(eventName.*, TelemetryType.interact, pageIndex) →
   * quml-library.service.ts's interact(id, currentPage), which always sends
   * `{type:'TOUCH', subtype:'', id, pageid}`). Use for button/action clicks
   * that aren't answer-selection (which has its own richer logOptionSelected
   * shape) — e.g. prev/next nav, hint/solution toggles, replay, review, zoom.
   */
  const logInteraction = useCallback((id: string, pageIndex?: number) => {
    raiseInteractEvent({
      type: 'TOUCH',
      subtype: '',
      id,
      pageid: pageIndex != null ? String(pageIndex) : '',
    });
  }, []);

  /** Log when a user selects an option/answer. */
  const logOptionSelected = useCallback(
    (questionId: string, answer: string | string[], pageIndex?: number) => {
      raiseInteractEvent({
        type: 'CHOOSE',
        id: Array.isArray(answer) ? answer.join(',') : String(answer),
        questionId,
        // Angular parity (quml-library.service.ts's interact()) — old always
        // sends these two fields; restored additively (id/questionId here carry
        // more signal than old's generic 'option_clicked', so kept as-is).
        subtype: '',
        pageid: pageIndex != null ? String(pageIndex) : '',
      });
    },
    [],
  );

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
   * `item` still omits `desc`/`params` — `desc` isn't in this project's Question
   * model at all (transformation-service never captures it), and `params` is a
   * per-question-type interaction descriptor old computed bespoke per type;
   * both need a dedicated pass, not a quick add here. `title` and `sectionId`
   * ARE available and restored below (Angular parity). `duration` is now the
   * real time spent on the question (caller-supplied), not hardcoded 0.
   */
  const logAnswerSubmitted = useCallback(
    (
      question: { identifier: string; qType?: string; primaryCategory?: string; name?: string },
      index: number,
      resvalues: unknown[],
      score: number,
      maxScore = 1,
      options?: { sectionId?: string; durationSec?: number },
    ) => {
      raiseAssessEvent({
        item: {
          id: question.identifier,
          title: question.name ?? '',
          type: (question.qType || question.primaryCategory || '').toLowerCase(),
          maxscore: maxScore,
          ...(options?.sectionId ? { sectionId: options.sectionId } : {}),
        },
        index,
        pass: score >= maxScore ? 'Yes' : 'No',
        score,
        resvalues,
        duration: options?.durationSec ?? 0,
      });
    },
    [],
  );

  /** Log when a page/section is viewed. */
  const logPageViewed = useCallback((pageId: string, pageIndex?: number) => {
    raiseImpressionEvent({
      pageId,
      // Angular parity (quml-library.service.ts's impression()) — restored
      // additively alongside the more descriptive `pageId` this player already
      // sends.
      type: 'workflow',
      subtype: '',
      uri: '',
      pageid: pageIndex != null ? String(pageIndex) : '',
    });
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

  /**
   * Log when the assessment is submitted (Angular parity: viewer-service
   * raiseEndEvent → quml-library.service.ts's end()). The wire edata carries a
   * `summary` array — the portal's calculateContentProgress (course-completion
   * tracking) merges this array and reads its `progress` key; the previous
   * `currentPage`/`totalPages` shape had no `progress` key at all, so progress
   * always resolved to 0 for QuestionSet content played inside a course.
   */
  const logAssessmentEnd = useCallback(
    (currentQuestionIndex: number, totalQuestions: number, durationMs: number, score: number) => {
      raiseEndEvent({
        type: 'content',
        mode: 'play',
        pageid: 'sunbird-player-Endpage',
        summary: [
          {
            progress:
              totalQuestions > 0
                ? Number(((currentQuestionIndex / totalQuestions) * 100).toFixed(0))
                : 0,
          },
          { totalNoofQuestions: totalQuestions },
          { visitedQuestions: totalQuestions },
          { endpageseen: true },
          { score },
        ],
        duration: Number((durationMs / 1e3).toFixed(2)),
      });
    },
    [],
  );

  /** Log the final score/summary breakdown (Angular parity: viewer-service raiseSummaryEvent). */
  const logSummary = useCallback(
    (
      summary: { correct: number; wrong: number; partial: number; skipped: number; score: number },
      meta: { currentQuestionIndex: number; totalQuestions: number; starttime: number },
    ) => {
      const endtime = Date.now();
      raiseSummaryEvent({
        type: 'content',
        mode: 'play',
        starttime: meta.starttime,
        endtime,
        // Angular parity intentionally NOT replicated: viewer-service.ts computes
        // this as `(elapsed % 60000) / 1000`, which wraps every 60s and reports a
        // wrong, much smaller value for any assessment over a minute long — a bug
        // in the old player, not a contract worth reproducing. Send real elapsed
        // seconds instead.
        timespent: Number(((endtime - meta.starttime) / 1000).toFixed(2)),
        pageviews: meta.totalQuestions,
        interactions: summary.correct + summary.wrong + summary.partial,
        extra: [
          {
            id: 'progress',
            value:
              meta.totalQuestions > 0
                ? ((meta.currentQuestionIndex / meta.totalQuestions) * 100).toFixed(0)
                : '0',
          },
          { id: 'endpageseen', value: 'true' },
          { id: 'score', value: summary.score.toString() },
          { id: 'correct', value: summary.correct.toString() },
          { id: 'incorrect', value: summary.wrong.toString() },
          { id: 'partial', value: summary.partial.toString() },
          { id: 'skipped', value: summary.skipped.toString() },
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
    logInteraction,
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
