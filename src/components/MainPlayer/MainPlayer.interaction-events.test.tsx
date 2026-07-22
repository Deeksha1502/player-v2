import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QumlProvider } from '../../context/QumlContext';
import { MainPlayer } from './MainPlayer';
import { subscribeTelemetry, clearEventQueue } from '../../services/telemetry-service';
import type { PlayerConfig } from '../../types';

// Angular parity (section-player.component.ts / main-player.component.ts's
// eventName.* heartbeat INTERACT triggers) — these were previously entirely
// unported; this locks in that the equivalent UI actions now raise INTERACT.
const twoQuestionData = {
  showTimer: false,
  sections: [
    {
      identifier: 's1',
      name: 'Section 1',
      timeLimits: { questionSet: { max: 0, min: 0 } },
      // Skip the correct/incorrect feedback dwell (proceedWithFeedback's
      // setTimeout) so Next/Submit clicks take effect synchronously in tests.
      showFeedback: false,
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
        {
          identifier: 'q2',
          body: '<p>Q2</p>',
          primaryCategory: 'Multiple Choice Question',
          interactions: { response1: { options: [{ value: 0, label: 'Cat' }, { value: 1, label: 'Dog' }] } },
          responseDeclaration: {
            response1: { cardinality: 'single', type: 'integer', correctResponse: { value: 0 } },
          },
        },
      ],
    },
  ],
};

function interactIds(received: { eid: string; edata: any }[]): string[] {
  return received.filter((e) => e.eid === 'INTERACT').map((e) => e.edata.id);
}

describe('MainPlayer — Angular-parity INTERACT triggers', () => {
  it('raises next_clicked and prev_clicked on section navigation', () => {
    const cfg: PlayerConfig = { context: {}, config: { language: 'en' }, data: twoQuestionData };
    clearEventQueue();
    const received: { eid: string; edata: any }[] = [];
    const unsub = subscribeTelemetry((e) => received.push(e));

    render(
      <QumlProvider playerConfig={cfg}>
        <MainPlayer playerConfig={cfg} />
      </QumlProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /start assessment/i }));
    fireEvent.click(screen.getByRole('button', { name: /start section/i }));

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(interactIds(received)).toContain('next_clicked');

    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(interactIds(received)).toContain('prev_clicked');

    unsub();
  });

  it('raises score_board_review_clicked (pre-submit review) then score_board_submit_clicked', () => {
    const cfg: PlayerConfig = {
      context: {},
      config: { language: 'en' },
      data: { ...twoQuestionData, sections: [{ ...twoQuestionData.sections[0], children: [twoQuestionData.sections[0].children[0]] }] },
    };
    clearEventQueue();
    const received: { eid: string; edata: any }[] = [];
    const unsub = subscribeTelemetry((e) => received.push(e));

    render(
      <QumlProvider playerConfig={cfg}>
        <MainPlayer playerConfig={cfg} />
      </QumlProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /start assessment/i }));
    fireEvent.click(screen.getByRole('button', { name: /start section/i }));
    fireEvent.click(screen.getAllByRole('radio')[0]);

    // Header's always-available Review entry point (shown on the last
    // question) opens the editable pre-submit review screen; its own Submit
    // action is what actually finalizes.
    fireEvent.click(screen.getByRole('button', { name: /^review$/i }));
    expect(interactIds(received)).toContain('score_board_review_clicked');

    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    expect(interactIds(received)).toContain('score_board_submit_clicked');

    unsub();
  });
});
