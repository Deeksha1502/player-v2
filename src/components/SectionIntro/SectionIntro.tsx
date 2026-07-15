import { t, readI18n } from '../../i18n/translations';
import { PreviousIcon } from '../icons';
import type { Section } from '../../types';
import styles from './SectionIntro.module.scss';

/**
 * SectionIntro — per-section introduction card (Phase 6 design, spec §6.3).
 *
 * Pure presentational: a banner (section letter + question count) over an
 * instructions panel and a "Start section" CTA. Rendered inside the assessment
 * shell (header + sidebar persist). Emits `onBegin`; no Context mutation.
 */
export interface SectionIntroProps {
  section: Section;
  sectionIndex: number;
  totalSections: number;
  onBegin: () => void;
  /** Back to the assessment overview (the "first page"). Renders a Previous link when set. */
  onPrevious?: () => void;
  language?: string;
}

export function SectionIntro({
  section,
  sectionIndex,
  onBegin,
  onPrevious,
  language = 'en',
}: SectionIntroProps) {
  const letter = String.fromCharCode(65 + sectionIndex);
  const questionCount = section.children?.length ?? 0;
  const instructions = readI18n(section.instructions, language) || t(language, 'MANDATORY_NOTE');
  // The section's actual authored name (matching StartPage's section cards /
  // Sidebar) — falls back to "Section {letter}" only when a section genuinely
  // has no name.
  const sectionName = readI18n(section.name, language) || `${t(language, 'SECTION')} ${letter}`;

  return (
    <div className={styles.wrap}>
      <div className={styles.column}>
        {onPrevious && (
          <button
            type="button"
            className={styles.backBtn}
            onClick={onPrevious}
            aria-label={t(language, 'PREVIOUS')}
          >
            <PreviousIcon size={16} /> <span className={styles.backBtnLabel}>{t(language, 'PREVIOUS')}</span>
          </button>
        )}

        <article className={styles.card}>
          <div className={styles.banner}>
            <span className={styles.bannerBadge} aria-hidden="true">
              {letter}
            </span>
            <div className={styles.bannerText}>
              <p className={styles.bannerEyebrow}>{sectionName}</p>
              <h1 className={styles.bannerTitle}>
                {questionCount} {t(language, 'QUESTIONS')}
              </h1>
            </div>
            <span className={styles.bannerDeco} aria-hidden="true" />
          </div>

          <div className={styles.body}>
            <div className={styles.instructions}>
              <h2 className={styles.instructionsHeading}>{t(language, 'INSTRUCTIONS')}</h2>
              <div
                className={styles.instructionsBody}
                dangerouslySetInnerHTML={{ __html: instructions }}
              />
            </div>

            <button type="button" className={styles.startBtn} onClick={onBegin}>
              {t(language, 'START_SECTION')} {letter} <span aria-hidden="true">→</span>
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
