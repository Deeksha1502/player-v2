import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QumlProvider } from '../../context/QumlContext';
import { MainPlayer } from './MainPlayer';
import { subscribeTelemetry, clearEventQueue } from '../../services/telemetry-service';
import type { PlayerConfig } from '../../types';

// Angular parity (viewer-service.ts raiseStartEvent/raiseEndEvent/raiseSummaryEvent) —
// the React player must raise the equivalent START/END/SUMMARY events at the
// same lifecycle points: assessment begins, and assessment is submitted.
const baseData = {
  showTimer: false,
  sections: [
    {
      identifier: 's1',
      name: 'Section 1',
      timeLimits: { questionSet: { max: 0, min: 0 } },
      children: [
        {
          identifier: 'q1',
          body: '<p>Q1</p>',
          primaryCategory: 'Multiple Choice Question',
          interactions: { response1: { options: [{ value: 0, label: 'Apple' }, { value: 1, label: 'Banana' }] } },
          responseDeclaration: {
            response1: { cardinality: 'single', type: 'integer', correctResponse: { value: 0 } },
          },
        },
      ],
    },
  ],
};

const enterAssessment = () => {
  fireEvent.click(screen.getByRole('button', { name: /start assessment/i }));
  fireEvent.click(screen.getByRole('button', { name: /start section/i }));
};

const submitAssessment = () => {
  fireEvent.click(screen.getAllByRole('radio')[0]);
  fireEvent.click(screen.getAllByRole('button', { name: /^submit$/i })[0]);
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /^submit$/i }));
};

describe('MainPlayer — telemetry lifecycle (Angular parity)', () => {
  it('raises START on assessment begin, IMPRESSION per question view, and END+SUMMARY on submit', () => {
    const cfg: PlayerConfig = {
      context: {},
      config: { language: 'en' },
      data: baseData,
    };
    clearEventQueue();
    const received: { eid: string }[] = [];
    const unsub = subscribeTelemetry((e) => received.push(e));

    render(
      <QumlProvider playerConfig={cfg}>
        <MainPlayer playerConfig={cfg} />
      </QumlProvider>,
    );

    enterAssessment();
    expect(received.some((e) => e.eid === 'START')).toBe(true);
    expect(received.some((e) => e.eid === 'IMPRESSION')).toBe(true);

    submitAssessment();
    expect(received.some((e) => e.eid === 'END')).toBe(true);
    expect(received.some((e) => e.eid === 'SUMMARY')).toBe(true);

    unsub();
  });

  it('does not raise a second START when re-entering the assessment via the same attempt', () => {
    const cfg: PlayerConfig = {
      context: {},
      config: { language: 'en' },
      data: baseData,
    };
    clearEventQueue();
    const received: { eid: string }[] = [];
    const unsub = subscribeTelemetry((e) => received.push(e));

    render(
      <QumlProvider playerConfig={cfg}>
        <MainPlayer playerConfig={cfg} />
      </QumlProvider>,
    );

    enterAssessment();
    const startCountAfterFirstEntry = received.filter((e) => e.eid === 'START').length;
    expect(startCountAfterFirstEntry).toBe(1);

    // Returning to overview and back in (brand click) must not re-raise START.
    // Button now reads "Resume assessment" since hasStarted flips after first entry.
    fireEvent.click(screen.getByRole('button', { name: /assessment overview/i }));
    fireEvent.click(screen.getByRole('button', { name: /resume assessment/i }));
    expect(received.filter((e) => e.eid === 'START').length).toBe(startCountAfterFirstEntry);

    unsub();
  });
});
