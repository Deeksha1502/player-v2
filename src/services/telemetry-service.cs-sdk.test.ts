import { describe, it, expect, vi, afterEach } from 'vitest';

const raiseInteractTelemetry = vi.fn();
const raiseAssesTelemetry = vi.fn();
const raiseImpressionTelemetry = vi.fn();
const raiseStartTelemetry = vi.fn();
const raiseEndTelemetry = vi.fn();
const raiseSummaryTelemetry = vi.fn();
const raiseErrorTelemetry = vi.fn();
const raiseResponseTelemetry = vi.fn();
const initTelemetry = vi.fn();
let isInitialised = false;
const init = vi.fn().mockImplementation(() => {
  isInitialised = true;
  return Promise.resolve();
});

vi.mock('@project-sunbird/client-services/telemetry', () => ({
  CsTelemetryModule: {
    get instance() {
      return {
        get isInitialised() {
          return isInitialised;
        },
        init,
        telemetryService: {
          initTelemetry,
          raiseInteractTelemetry,
          raiseAssesTelemetry,
          raiseImpressionTelemetry,
          raiseStartTelemetry,
          raiseEndTelemetry,
          raiseSummaryTelemetry,
          raiseErrorTelemetry,
          raiseResponseTelemetry,
        },
      };
    },
  },
}));

// Imported after the mock so telemetry-service picks up the mocked SDK.
const {
  initializeTelemetry,
  raiseInteractEvent,
  raiseAssessEvent,
  raiseImpressionEvent,
  raiseStartEvent,
  raiseEndEvent,
  raiseSummaryEvent,
  raiseErrorEvent,
  raiseResponseEvent,
  clearCsTelemetryOptions,
} = await import('./telemetry-service');

const fullContext = {
  uid: 'u1',
  sid: 's1',
  did: 'd1',
  channel: 'ch1',
  pdata: { id: 'org.sunbird', ver: '1.0' },
  host: 'https://example.org',
};

describe('telemetry-service — CS SDK integration', () => {
  afterEach(() => {
    clearCsTelemetryOptions();
    isInitialised = false;
    vi.clearAllMocks();
  });

  it('does not touch the CS SDK when context is empty (Angular parity: silent no-op)', () => {
    initializeTelemetry({} as any);
    raiseInteractEvent({ a: 1 });
    raiseAssessEvent({ a: 1 });
    raiseImpressionEvent({ a: 1 });
    raiseStartEvent({ a: 1 });
    raiseEndEvent({ a: 1 });
    raiseSummaryEvent({ a: 1 });
    raiseErrorEvent({ a: 1 });
    raiseResponseEvent({ a: 1 });

    expect(init).not.toHaveBeenCalled();
    expect(raiseInteractTelemetry).not.toHaveBeenCalled();
    expect(raiseAssesTelemetry).not.toHaveBeenCalled();
    expect(raiseImpressionTelemetry).not.toHaveBeenCalled();
    expect(raiseStartTelemetry).not.toHaveBeenCalled();
    expect(raiseEndTelemetry).not.toHaveBeenCalled();
    expect(raiseSummaryTelemetry).not.toHaveBeenCalled();
    expect(raiseErrorTelemetry).not.toHaveBeenCalled();
    expect(raiseResponseTelemetry).not.toHaveBeenCalled();
  });

  it('initializes the CS SDK when a real context is provided', () => {
    initializeTelemetry(fullContext as any);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('does not re-init the CS SDK once already initialised', async () => {
    initializeTelemetry(fullContext as any);
    await Promise.resolve();
    await Promise.resolve();
    initializeTelemetry(fullContext as any);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('regression: does not start a second concurrent init() before the first resolves (React StrictMode double-invoke)', async () => {
    // isInitialised only flips true once init() RESOLVES, not when it's
    // called — model that explicitly here (the other tests' mock flips it
    // synchronously, which would mask this exact race).
    isInitialised = false;
    let resolveInit: () => void;
    init.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolveInit = () => {
          isInitialised = true;
          resolve();
        };
      }),
    );

    initializeTelemetry(fullContext as any); // 1st call: starts init(), still pending
    initializeTelemetry(fullContext as any); // 2nd call (e.g. StrictMode remount): must NOT start a 2nd init()

    expect(init).toHaveBeenCalledTimes(1);
    resolveInit!();
    await new Promise((r) => setTimeout(r, 0));
    expect(initTelemetry).toHaveBeenCalledTimes(1);
  });

  it('regression: omits apislug entirely when the host does not provide one, so the SDK\'s own "/action" default applies', async () => {
    // The portal's telemetryContextBuilder.ts never sets context.apislug (nor
    // does Angular's quml-library.service.ts) — both rely on the legacy
    // engine's built-in default ('/action'), which only takes effect if this
    // key is ABSENT from the config object (Object.assign would overwrite the
    // default even with an empty string).
    initializeTelemetry(fullContext as any);
    await new Promise((r) => setTimeout(r, 0));

    expect(initTelemetry).toHaveBeenCalledTimes(1);
    const passedConfig = initTelemetry.mock.calls[0][0].config;
    expect(passedConfig).not.toHaveProperty('apislug');
  });

  it('regression: includes apislug when the host explicitly provides one', async () => {
    initializeTelemetry({ ...fullContext, apislug: '/custom' } as any);
    await new Promise((r) => setTimeout(r, 0));

    const passedConfig = initTelemetry.mock.calls[0][0].config;
    expect(passedConfig.apislug).toBe('/custom');
  });

  it('raiseInteractEvent forwards to raiseInteractTelemetry with the object/context envelope', () => {
    initializeTelemetry(fullContext as any);
    raiseInteractEvent({ type: 'CHOOSE', id: 'A', questionId: 'q1' });

    expect(raiseInteractTelemetry).toHaveBeenCalledTimes(1);
    const arg = raiseInteractTelemetry.mock.calls[0][0];
    expect(arg.edata).toMatchObject({ type: 'CHOOSE', id: 'A', questionId: 'q1' });
    expect(arg.options.context).toMatchObject({ channel: 'ch1', uid: 'u1', sid: 's1' });
    expect(arg.options.object).toMatchObject({ type: 'Content' });
  });

  it('raiseAssessEvent forwards to raiseAssesTelemetry(data, options)', () => {
    initializeTelemetry(fullContext as any);
    raiseAssessEvent({ type: 'assess', questionId: 'q1', score: 1, maxScore: 1 });

    expect(raiseAssesTelemetry).toHaveBeenCalledTimes(1);
    const [data, options] = raiseAssesTelemetry.mock.calls[0];
    expect(data).toMatchObject({ questionId: 'q1' });
    expect(options.context).toBeDefined();
  });

  it('raiseImpressionEvent forwards to raiseImpressionTelemetry', () => {
    initializeTelemetry(fullContext as any);
    raiseImpressionEvent({ pageId: 'start' });
    expect(raiseImpressionTelemetry).toHaveBeenCalledTimes(1);
  });

  it('raiseStartEvent forwards to raiseStartTelemetry', () => {
    initializeTelemetry(fullContext as any);
    raiseStartEvent({ type: 'content', mode: 'play' });
    expect(raiseStartTelemetry).toHaveBeenCalledTimes(1);
  });

  it('raiseEndEvent forwards to raiseEndTelemetry', () => {
    initializeTelemetry(fullContext as any);
    raiseEndEvent({ type: 'content', mode: 'play' });
    expect(raiseEndTelemetry).toHaveBeenCalledTimes(1);
  });

  it('raiseSummaryEvent forwards to raiseSummaryTelemetry(data, options)', () => {
    initializeTelemetry(fullContext as any);
    raiseSummaryEvent({ type: 'content' });
    expect(raiseSummaryTelemetry).toHaveBeenCalledTimes(1);
  });

  it('raiseErrorEvent forwards to raiseErrorTelemetry', () => {
    initializeTelemetry(fullContext as any);
    raiseErrorEvent({ err: 'LOAD', errtype: 'content', stacktrace: '' });
    expect(raiseErrorTelemetry).toHaveBeenCalledTimes(1);
  });

  it('raiseResponseEvent forwards to raiseResponseTelemetry(data, options)', () => {
    initializeTelemetry(fullContext as any);
    raiseResponseEvent({ target: { id: 'q1', ver: '1.0', type: 'MCQ' }, type: 'CHOOSE', values: [{ option: 0 }] });

    expect(raiseResponseTelemetry).toHaveBeenCalledTimes(1);
    const [data, options] = raiseResponseTelemetry.mock.calls[0];
    expect(data).toMatchObject({ target: { id: 'q1' } });
    expect(options.context).toBeDefined();
  });

  it('clears the envelope so a later empty-context init stops sending to the CS SDK', () => {
    initializeTelemetry(fullContext as any);
    initializeTelemetry({} as any);
    raiseInteractEvent({ a: 1 });
    expect(raiseInteractTelemetry).not.toHaveBeenCalled();
  });

  it('regression: object.id comes from context.contentId (portal\'s field name), not context.identifier', () => {
    // The portal's telemetryContextBuilder.ts sets `contentId`, never
    // `identifier` — reading the wrong key here silently left object.id
    // empty on every event in production.
    initializeTelemetry({ ...fullContext, contentId: 'do_123' } as any);
    raiseStartEvent({ type: 'content', mode: 'play' });

    const arg = raiseStartTelemetry.mock.calls[0][0];
    expect(arg.options.object).toMatchObject({ id: 'do_123' });
  });

  it('regression: does not call the bridge SDK.initialize(context) directly when the CS SDK is active', () => {
    // Reproduces the real-world bug: a bare `sdk.initialize(rawContext)` call
    // racing CsTelemetryModule's own async initTelemetry(fullTelemetryConfig)
    // — whichever wins locks in Telemetry.initialized for the page's lifetime
    // via the legacy engine's own guard, silently dropping pdata/apislug/etc
    // if the bare call wins. usingCsSdk must suppress the bare call entirely.
    const initializeSpy = vi.fn();
    (window as any).EkTelemetry = { initialize: initializeSpy, logEvent: vi.fn() };

    initializeTelemetry(fullContext as any);

    expect(initializeSpy).not.toHaveBeenCalled();
    delete (window as any).EkTelemetry;
  });
});
