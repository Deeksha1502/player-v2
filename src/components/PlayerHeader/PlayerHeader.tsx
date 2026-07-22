import { useState } from 'react';
import { t, readI18n } from '../../i18n/translations';
import { TimerIcon, MenuIcon } from '../icons';
import type { Section } from '../../types';
import styles from './PlayerHeader.module.scss';

/**
 * PlayerHeader — persistent assessment shell header (Phase 6 design).
 *
 * Pure presentational: brand + section step indicators (left) and timer, help,
 * global question counter, and Submit (right). All data is supplied by MainPlayer
 * from Context; intent is emitted via callbacks. No Context mutation.
 */
export interface PlayerHeaderProps {
  brand: string;
  sections: Section[];
  currentSectionIndex: number;
  completed: boolean[];
  /** Seconds remaining (countdown mode); null/omitted hides the countdown. */
  timeRemaining?: number | null;
  /**
   * Seconds elapsed (count-up mode — Angular header showCountUp parity, shown
   * when there is no time limit). Ignored while a countdown is active.
   */
  timeElapsed?: number | null;
  questionNumber: number;
  totalQuestions: number;
  onSubmit: () => void;
  /**
   * Entry point into the (editable, pre-submit) review screen — independent
   * of whether the Submit button shows a confirmation dialog. Omit to hide
   * the button entirely.
   */
  onReview?: () => void;
  /**
   * Review is only actionable on the last question of the last section; the
   * button stays visible everywhere so it's discoverable, but is disabled
   * (with a tooltip) until then. Defaults to true (enabled) when omitted.
   */
  reviewAvailable?: boolean;
  onMenuClick?: () => void;
  /** Click the brand to return to the overview / start page. */
  onBrandClick?: () => void;
  /**
   * Mobile-app only (see `.sectionLabel` — hidden outside `m.compact`) — e.g.
   * "Section A · 2 Questions", shown in place of the section-intro screen's
   * banner (removed there in compact mode). Omit outside the section-intro
   * stage.
   */
  sectionLabel?: string;
  language?: string;
}

function formatMmSs(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function PlayerHeader({
  brand,
  sections,
  currentSectionIndex,
  completed,
  timeRemaining = null,
  timeElapsed = null,
  questionNumber,
  totalQuestions,
  onSubmit,
  onReview,
  reviewAvailable = true,
  onMenuClick,
  onBrandClick,
  sectionLabel,
  language = 'en',
}: PlayerHeaderProps) {
  // Countdown takes precedence; count-up shows when there is no time limit.
  const showCountdown = timeRemaining != null;
  const showTimer = showCountdown || timeElapsed != null;
  const isTimeLow = showCountdown && timeRemaining <= 60;
  const [showLegend, setShowLegend] = useState(false);

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        {onMenuClick && (
          <button
            type="button"
            className={styles.menuBtn}
            onClick={onMenuClick}
            aria-label={t(language, 'OPEN_MENU')}
          >
            <MenuIcon size={20} />
          </button>
        )}

        <button
          type="button"
          className={styles.brand}
          onClick={onBrandClick}
          aria-label={`${brand} — ${t(language, 'ASSESSMENT_OVERVIEW')}`}
        >
          <span className={styles.brandBadge} aria-hidden="true">
            {brand.charAt(0).toUpperCase()}
          </span>
          <span className={styles.brandName}>{brand}</span>
        </button>

        {sectionLabel && <span className={styles.sectionLabel}>{sectionLabel}</span>}

        <ol className={styles.steps} aria-label={t(language, 'SECTIONS')}>
          {sections.map((section, index) => {
            const status =
              index === currentSectionIndex
                ? 'active'
                : completed[index]
                  ? 'completed'
                  : 'upcoming';
            return (
              <li
                key={section.identifier}
                className={`${styles.step} ${styles[status]}`}
                aria-current={status === 'active' ? 'step' : undefined}
                title={readI18n(section.name, language)}
              >
                <span className={styles.stepDot}>{String.fromCharCode(65 + index)}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className={styles.right}>
        {showTimer && (
          <div
            className={`${styles.timer} ${isTimeLow ? styles.timerLow : ''}`.trim()}
            role="timer"
            aria-label={t(language, 'TIME_REMAINING')}
          >
            <TimerIcon size={16} />
            <span className={styles.timerValue}>
              {formatMmSs(showCountdown ? timeRemaining! : timeElapsed!)}
            </span>
          </div>
        )}

        <div className={styles.helpWrap}>
          <button
            type="button"
            className={styles.help}
            onClick={() => setShowLegend((s) => !s)}
            aria-label={t(language, 'HELP_LEGEND_TITLE')}
            aria-expanded={showLegend}
          >
            ?
          </button>

          {showLegend && (
            <>
              <div className={styles.legendBackdrop} onClick={() => setShowLegend(false)} />
              <div className={styles.legend} role="dialog" aria-label={t(language, 'HELP_LEGEND_TITLE')}>
                <p className={styles.legendTitle}>{t(language, 'HELP_LEGEND_TITLE')}</p>
                <div className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.active}`} aria-hidden="true">A</span>
                  <span>{t(language, 'SECTION_CURRENT')}</span>
                </div>
                <div className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.completed}`} aria-hidden="true">A</span>
                  <span>{t(language, 'SECTION_DONE')}</span>
                </div>
                <div className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.upcoming}`} aria-hidden="true">B</span>
                  <span>{t(language, 'SECTION_UPCOMING')}</span>
                </div>
                <div className={styles.legendItem}>
                  <span className={`${styles.legendMark} ${styles.answered}`} aria-hidden="true">●</span>
                  <span>{t(language, 'ANSWERED')}</span>
                </div>
                <div className={styles.legendItem}>
                  <span className={`${styles.legendMark} ${styles.unanswered}`} aria-hidden="true">○</span>
                  <span>{t(language, 'UNANSWERED')}</span>
                </div>
              </div>
            </>
          )}
        </div>

        <span className={styles.counter}>
          {questionNumber}/{totalQuestions}
        </span>

        {onReview && (
          // The tooltip lives on this wrapping span, not the button itself —
          // disabled buttons generally don't show their own `title` (and
          // aren't focusable), so the explanation would otherwise be
          // impossible to discover on hover.
          <span title={reviewAvailable ? undefined : t(language, 'REVIEW_AVAILABLE_AT_END')}>
            <button
              type="button"
              className={styles.reviewBtn}
              onClick={onReview}
              disabled={!reviewAvailable}
            >
              {t(language, 'REVIEW')}
            </button>
          </span>
        )}

        <button type="button" className={styles.submitBtn} onClick={onSubmit}>
          {t(language, 'SUBMIT')}
        </button>
      </div>
    </header>
  );
}
