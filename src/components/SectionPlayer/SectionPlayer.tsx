import { useEffect, useRef, useState } from 'react';
import { useQuml } from '../../context/useQuml';
import { useTelemetry } from '../../context/useTelemetry';
import { QuestionRenderer } from '../QuestionRenderer/QuestionRenderer';
import { QuestionCard } from '../QuestionCard/QuestionCard';
import { Hint } from '../Hint/Hint';
import { Toast } from '../Toast/Toast';
import { ImageViewer } from '../ImageViewer/ImageViewer';
import { useImageZoom } from '../ImageViewer/useImageZoom';
import { PreviousIcon, NextIcon } from '../icons';
import { t } from '../../i18n/translations';
import { calculateScore } from '../../registry/scoring-registry';
import { isAnswered } from '../../utils/answered';
import { canGoToNextQuestion, isQuestionSkippable } from '../../services/navigation-service';
import { pageId } from '../../utils/constants';
import type { MediaItem, MediaResolveContext } from '../../utils/media';
import type { Question, Section, UserResponse } from '../../types';
import styles from './SectionPlayer.module.scss';

type AlertKind = 'correct' | 'incorrect' | 'partial' | 'info';
interface AlertState {
  type: AlertKind;
  message: string;
}

/** How long the Correct/Wrong toast dwells on the current question before auto-advancing. */
const FEEDBACK_DWELL_MS = 1000;

/**
 * SectionPlayer — orchestrates one section's question carousel: answer storage
 * (Context), scoring (registry), telemetry (hook), feedback (Alert), and the
 * question footer nav. The persistent shell header/timer live in MainPlayer; this
 * is where ALL per-answer business logic lives. Question components stay pure.
 */
interface SectionPlayerProps {
  section: Section | undefined;
  onSectionEnd?: () => void;
  /** True only for the final section — its last question shows Submit, not Next. */
  isLastSection?: boolean;
}

export function SectionPlayer({ section, onSectionEnd, isLastSection = true }: SectionPlayerProps) {
  const { state, storeAnswer, setCurrentQuestion } = useQuml();
  const {
    logInteraction,
    logOptionSelected,
    logAnswerSubmitted,
    logPageViewed,
    logResponse,
    flushAssessEvent,
    cancelAssessEvent,
  } = useTelemetry();
  const language = state.language;

  const questions: Question[] = section?.children ?? [];

  const [currentSlide, setCurrentSlide] = useState(0);
  const [currentAlert, setCurrentAlert] = useState<AlertState | null>(null);

  // Image zoom / click-to-enlarge over the whole question area (stem + options +
  // revealed solution), mirroring Angular's document-wide setImageZoom pass.
  const contentRef = useRef<HTMLDivElement>(null);
  const zoom = useImageZoom(contentRef, [currentSlide, language]);

  // Honor external jumps: the sidebar emits setCurrentQuestion (Context is the
  // source of truth for the active index); sync the carousel to follow it.
  const externalIndex = state.currentQuestionIndex;
  useEffect(() => {
    setCurrentSlide(externalIndex);
  }, [externalIndex]);

  // Angular parity (viewer-service raiseHeartBeatEvent 'impression') — one
  // IMPRESSION per question view.
  useEffect(() => {
    logPageViewed(pageId.QUESTION_PAGE, externalIndex);
  }, [externalIndex, logPageViewed]);

  // Angular parity (section-player.component.ts's slideDuration) — how long the
  // learner has been on the current question, for ASSESS's `duration` field.
  const slideEnteredAtRef = useRef(Date.now());
  useEffect(() => {
    slideEnteredAtRef.current = Date.now();
  }, [currentSlide]);

  // ASSESS events are debounced per-question (telemetry-service.ts) — flush
  // the LEAVING question's pending one right before the slide changes again
  // (internal Next/Previous, an external sidebar jump, or unmount — the
  // latter also covers moving to a new section, since MainPlayer keys
  // SectionPlayer by section index, forcing a remount), so a debounced
  // answer isn't left waiting out its timer after the learner has moved on.
  // Scoped to just this question — a still-pending different question
  // elsewhere isn't force-flushed too. `questions` is intentionally left
  // out of the deps (recomputed fresh every render from section.children;
  // depending on it would re-fire this effect on every render) — read
  // fresh at cleanup time instead.
  useEffect(() => {
    return () => {
      const leavingQuestionId = questions[currentSlide]?.identifier;
      if (leavingQuestionId) flushAssessEvent(leavingQuestionId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlide, flushAssessEvent]);

  // Feedback dwell: how long the Correct/Wrong toast stays on the current
  // question before auto-advancing (see proceedWithFeedback).
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearFeedbackTimer = () => {
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
  };
  useEffect(() => clearFeedbackTimer, []);

  /**
   * Central answer handler — stores the answer + raises telemetry ONLY.
   * Feedback is intentionally NOT shown here: for multi-step types (REO/SEQ/
   * MTF/FTB) this fires on every partial move, so scoring an incomplete answer
   * would flash "Wrong Answer" mid-edit. Feedback is validated on Next/Submit
   * instead (Angular parity: alert is raised in validateSelectedOption on
   * navigation, never in onOptionSelect).
   */
  const handleQuestionAnswer = (answer: UserResponse) => {
    const currentQuestion = questions[currentSlide];
    if (!currentQuestion) return;

    // A new interaction dismisses any pending feedback + its auto-advance timer
    // (e.g. the learner keeps editing after clicking Next).
    clearFeedbackTimer();
    setCurrentAlert(null);
    storeAnswer(currentQuestion.identifier, answer);

    const selected =
      answer.value ?? answer.order ?? answer.responses ?? answer.matches;
    logOptionSelected(currentQuestion.identifier, selected as string | string[], currentSlide);

    // An empty response (e.g. everything de-selected, a cleared blank) is not an
    // attempt: skip the ASSESS event so it isn't counted or scored, and cancel
    // any earlier debounced ASSESS for this question so a stale value can't
    // fire later.
    if (!isAnswered(answer)) {
      cancelAssessEvent(currentQuestion.identifier);
      return;
    }

    // calculateScore returns a 0..1 fraction; ASSESS must carry the EARNED marks
    // (fraction × maxScore) so the reported score/maxScore pair is consistent
    // with the results screen (which also scales by maxScore).
    const maxScore = currentQuestion.maxScore ?? 1;
    const earned = calculateScore(currentQuestion, answer, language) * maxScore;
    // Angular parity: index is 1-based within the section (currentIndex + 1);
    // resvalues wraps the selected value(s) as a one-element array
    // (section-player.component.ts's `[option.option]`) — critically, that
    // element must be an OBJECT. The backend's AssessmentParser.getListValues
    // (lern-service) unconditionally does `res.asScala` on every resvalues
    // element, assuming it's a Map; a bare primitive (e.g. MCQ's raw option
    // index) throws a ClassCastException that aborts the WHOLE event list for
    // that submission — silently dropping the entire assessment, not just one
    // question. Wrapping in {value: selected} guarantees a Map regardless of
    // question type (MCQ's number, SEQ/REO's array, FTB/MTF's object).
    const durationSec = Number(((Date.now() - slideEnteredAtRef.current) / 1000).toFixed(2));
    logAnswerSubmitted(
      currentQuestion,
      currentSlide + 1,
      [{ value: selected }],
      earned,
      maxScore,
      { sectionId: section?.identifier, durationSec },
    );
  };

  /**
   * Validate the current answer when the learner tries to advance/submit, then
   * run `proceed`. Feedback is non-blocking:
   * - feedback OFF or unanswered → proceed silently.
   * - otherwise → show "Correct Answer" / "Wrong Answer" and ALWAYS advance; the
   *   toast rides onto the next question and auto-dismisses (no delay, no block).
   */
  const proceedWithFeedback = (proceed: () => void) => {
    const currentQuestion = questions[currentSlide];
    const answer = currentQuestion ? state.answers[currentQuestion.identifier] : undefined;
    // Feedback is suppressed when disabled at ANY level — assessment config,
    // section, or question (each explicit `false`; undefined = not set, so it
    // does not suppress) — or when there is nothing scored to give feedback on.
    if (
      state.config?.showFeedback === false ||
      section?.showFeedback === false ||
      currentQuestion?.showFeedback === false ||
      !currentQuestion ||
      !isAnswered(answer)
    ) {
      proceed();
      return;
    }

    // Show the verdict on the CURRENT question, hold briefly so it's clearly tied
    // to this question (never bleeds onto the next), then clear + advance. All of
    // correct / partial / wrong auto-advance (non-blocking). Partial covers any
    // 0 < score < 1 (e.g. MAP_RESPONSE MTF with some pairs matched).
    const score = calculateScore(currentQuestion, answer, language);
    const kind: AlertKind = score >= 1 ? 'correct' : score > 0 ? 'partial' : 'incorrect';
    const msgKey = score >= 1 ? 'CORRECT_ANSWER' : score > 0 ? 'PARTIAL_SCORE' : 'INCORRECT_ANSWER';
    setCurrentAlert({
      type: kind,
      message: t(language, msgKey),
    });
    clearFeedbackTimer();
    feedbackTimer.current = setTimeout(() => {
      setCurrentAlert(null);
      proceed();
    }, FEEDBACK_DWELL_MS);
  };

  const goTo = (index: number) => {
    clearFeedbackTimer();
    setCurrentSlide(index);
    setCurrentQuestion(index);
    setCurrentAlert(null);
  };
  // Navigation restriction (spec §6.9): when the section is not skippable, gate
  // "Next" on the current question being answered (navigation-service is the
  // single source of navigation rules — no rule logic lives in this component).
  const requireAnswer = !isQuestionSkippable(section);
  const canAdvance = canGoToNextQuestion(currentSlide, questions, state.answers, { requireAnswer });
  const handleNext = () => {
    proceedWithFeedback(() => {
      if (!canAdvance) return;
      // Angular parity (section-player.component.ts:346, nextSlide()) — RESPONSE
      // fires once per question, on navigating away from it via Next, using
      // whatever was last selected (undefined if left unanswered). Distinct
      // from ASSESS (fires on answering) and INTERACT (fires on every click).
      const leavingQuestion = questions[currentSlide];
      const leavingAnswer = state.answers[leavingQuestion.identifier];
      const option = leavingAnswer
        ? (leavingAnswer.value ?? leavingAnswer.order ?? leavingAnswer.responses ?? leavingAnswer.matches)
        : undefined;
      logResponse(leavingQuestion.identifier, leavingQuestion.qType, option);
      // Angular parity (section-player.component.ts:329, eventName.nextClicked).
      logInteraction('next_clicked', currentSlide + 1);
      goTo(currentSlide + 1);
    });
  };
  const handlePrevious = () => {
    if (currentSlide > 0) {
      // Angular parity (section-player.component.ts:373, eventName.prevClicked).
      logInteraction('prev_clicked', currentSlide - 1);
      goTo(currentSlide - 1);
    }
  };
  const handleSubmit = () => {
    proceedWithFeedback(() => onSectionEnd?.());
  };

  if (questions.length === 0) {
    return <div className={styles.error}>{t(language, 'ERROR_LOADING')}</div>;
  }

  const currentQuestion = questions[currentSlide];
  const isFirst = currentSlide === 0;
  const isLast = currentSlide === questions.length - 1;
  // "View Solution" unlocks once the learner has interacted with this question
  // (an answer is stored for it in Context).
  const hasInteracted = isAnswered(state.answers[currentQuestion.identifier]);

  // Media-resolution context for solution/hint assets (mirrors QuestionRenderer).
  const offline = state.playerConfig?.metadata;
  const mediaCtx: MediaResolveContext = {
    media: currentQuestion.media as MediaItem[] | undefined,
    basePath: offline?.basePath,
    isAvailableLocally: offline?.isAvailableLocally,
    sectionId: section?.identifier,
    questionId: currentQuestion.identifier,
  };

  return (
    <div className={styles.sectionPlayer}>
      <div className={styles.navBar}>
        <button
          type="button"
          className={`${styles.navBtn} ${styles.navPrev}`}
          onClick={handlePrevious}
          disabled={isFirst}
          aria-label={t(language, 'PREVIOUS')}
        >
          <PreviousIcon size={18} />
          <span className={styles.navLabel}>{t(language, 'PREVIOUS')}</span>
        </button>

        {/* Desktop/tablet only (hidden in compact mode via QuestionCard's
            progress badge) — kept here so the counter stays centered. */}
        <span className={styles.counter}>
          {t(language, 'QUESTION')} {currentSlide + 1} {t(language, 'OF')} {questions.length}
        </span>

        {isLast && isLastSection ? (
          // Final question of the final section → no bottom action. The persistent
          // header "Submit" finishes the assessment, so a bottom Submit here would
          // duplicate it. Hidden placeholder MIRRORS the Next button's structure so
          // it matches "Previous"'s width and the counter stays centered. It is
          // non-interactive (aria-hidden, not focusable, disabled).
          <button
            type="button"
            className={`${styles.navBtn} ${styles.navNext}`}
            style={{ visibility: 'hidden' }}
            aria-hidden="true"
            tabIndex={-1}
            disabled
          >
            <span className={styles.navLabel}>{t(language, 'NEXT')}</span>
            <NextIcon size={18} />
          </button>
        ) : (
          // Otherwise Next: advances within the section, or to the next section
          // when on a section's last question.
          <button
            type="button"
            className={`${styles.navBtn} ${styles.navNext}`}
            onClick={isLast ? handleSubmit : handleNext}
            // Last question: enabled once answered (or section is skippable) so the
            // learner can move to the next section. Otherwise gate on canAdvance.
            disabled={isLast ? requireAnswer && !hasInteracted : !canAdvance}
            aria-label={t(language, 'NEXT')}
          >
            <span className={styles.navLabel}>{t(language, 'NEXT')}</span>
            <NextIcon size={18} />
          </button>
        )}
      </div>

      <div className={styles.content} ref={contentRef}>
        <QuestionCard
          question={currentQuestion}
          meta={{ category: currentQuestion.primaryCategory }}
          progress={{ current: currentSlide + 1, total: questions.length }}
        >
          <QuestionRenderer
            key={currentQuestion.identifier}
            question={currentQuestion}
            shuffleOptions={currentQuestion.shuffleOptions}
            onOptionSelected={handleQuestionAnswer}
            onGoToNext={handleNext}
          />

          <Hint
            hints={currentQuestion.hints}
            solutions={currentQuestion.solutions}
            canViewSolution={hasInteracted}
            showHints={section?.showHints}
            showSolutions={section?.showSolutions}
            language={language}
            mediaCtx={mediaCtx}
            pageIndex={currentSlide}
          />
        </QuestionCard>
      </div>

      <ImageViewer
        state={zoom.state}
        onClose={zoom.close}
        onZoomIn={zoom.zoomIn}
        onZoomOut={zoom.zoomOut}
      />

      {currentAlert && (
        <Toast
          type={currentAlert.type}
          message={currentAlert.message}
          onClose={() => setCurrentAlert(null)}
        />
      )}
    </div>
  );
}
