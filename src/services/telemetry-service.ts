// The legacy vanilla-JS telemetry engine self-registers as `window.EkTelemetry`
// on load, but ONLY when run as a raw global <script> — its top-level IIFE
// does `this.telemetry = ...`, relying on sloppy-mode `this === window`. The
// Angular player gets this for free by injecting the package as a literal
// <script> tag (angular.json's `scripts` array, outside its module graph). A
// plain `import '@project-sunbird/telemetry-sdk'` does NOT work here: Vite/ESM
// modules always run in strict mode, where a bare top-level `this` is
// `undefined`, not `window` — the IIFE throws immediately ("Cannot set
// properties of undefined (setting 'telemetry')") instead of registering.
// Fix: pull its source in as a raw string (`?raw` — Vite/esbuild treat this as
// opaque text, never re-parsed as a module) and inject it as a REAL <script>
// element at runtime. A `<script>` tag's own execution context is a classic
// non-module global script, so `this` resolves to `window` there exactly as
// it does for Angular's <script>-tag inclusion.
import telemetrySdkSource from '@project-sunbird/telemetry-sdk/index.js?raw';
import { CsTelemetryModule } from '@project-sunbird/client-services/telemetry';
import jQuery from 'jquery';
import { generateID } from '../utils/id';
import type { TelemetryContext } from '../types';

/**
 * Telemetry Service - internal abstraction with a queue-based implementation,
 * plus a real Sunbird telemetry SDK (`@project-sunbird/client-services`) sender.
 *
 * Two independent delivery paths, both fed by the same raise* calls:
 * - `window.EkTelemetry`/`logEvent` bridge (below) — for hosts that inject
 *   their own SDK object (e.g. mobile WebView). Unchanged by this file.
 * - `CsTelemetryModule` — the real Sunbird v3 telemetry envelope + batching +
 *   POST to the telemetry endpoint. Mirrors the Angular player's
 *   `quml-library.service.ts`. Backed by `@project-sunbird/telemetry-sdk`
 *   (loaded below) as its `window.EkTelemetry` engine.
 */

let legacyTelemetrySdkLoaded = false;

/** Loads the legacy telemetry-sdk as a real global <script> (see note above). */
function loadLegacyTelemetrySdk(): void {
  if (legacyTelemetrySdkLoaded || typeof document === 'undefined') return;
  if ((window as any).EkTelemetry) {
    legacyTelemetrySdkLoaded = true;
    return;
  }
  // The legacy SDK's actual network dispatch calls the bare global `jQuery.ajax(...)`
  // (not an import) — it expects jQuery pre-loaded as a global <script>, same as
  // Angular's angular.json `scripts` array does. Without this, initialization
  // succeeds silently but every batch flush throws "jQuery is not defined" the
  // first time enough events accumulate to actually dispatch.
  if (!(window as any).jQuery) {
    (window as any).jQuery = jQuery;
    (window as any).$ = (window as any).$ ?? jQuery;
  }
  const script = document.createElement('script');
  // `//# sourceURL=...` gives Chrome/Firefox DevTools a real file name for this
  // dynamically-injected script in the Sources panel, instead of an anonymous
  // `VM<n>` entry with no path — purely a debuggability aid, no behavior change.
  script.textContent = `${telemetrySdkSource}\n//# sourceURL=telemetry-sdk.js`;
  document.head.appendChild(script);
  legacyTelemetrySdkLoaded = true;
}

interface TelemetryEvent {
  eid: string;
  edata: unknown;
  timestamp: number;
}

let telemetrySDK: any = null;
let eventQueue: TelemetryEvent[] = [];

/**
 * Sunbird v3 telemetry `object`/`context` envelope, built once per
 * `initializeTelemetry` call and reused by every raise* call. `null` when no
 * (or an empty) context was provided — matches Angular's
 * `quml-library.service.ts:27-30`, which no-ops all CS SDK telemetry entirely
 * when `config.context` is empty, rather than queuing/degrading silently.
 */
let csEventOptions: { object: unknown; context: unknown } | null = null;

/**
 * Guards against concurrent `CsTelemetryModule.instance.init({})` calls —
 * `isInitialised` only flips true once `.init()` RESOLVES, so two
 * `initializeTelemetry` calls in the same tick (React 18 StrictMode
 * double-invokes effects in dev; a host could also call init twice) would
 * otherwise both see `isInitialised === false` and both start `.init({})`.
 * Reset on failure so a later call can still retry.
 */
let csSdkInitInFlight = false;

function isEmptyContext(context: TelemetryContext | null | undefined): boolean {
  return !context || Object.keys(context).length === 0;
}

/**
 * Telemetry bridge (Phase 8): listeners are notified of every raised event so a
 * host (e.g. the web component) can forward them to `onTelemetryEvent`. Additive
 * — the queue/SDK behaviour is unchanged.
 */
type TelemetryListener = (event: TelemetryEvent) => void;
const listeners = new Set<TelemetryListener>();

/** Subscribe to raised telemetry events. Returns an unsubscribe function. */
export function subscribeTelemetry(listener: TelemetryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: TelemetryEvent): void {
  listeners.forEach((listener) => listener(event));
}

/**
 * Builds the CS SDK's `initTelemetry` config + the reusable object/context
 * envelope, mirroring `quml-library.service.ts:initializeTelemetry`. Fire-and-
 * forget on `CsTelemetryModule.instance.init(...)` — the Angular player does
 * the same (its own `initializeTelemetry` is `async` but is never `await`ed by
 * its caller, `viewer-service.ts:initialize`).
 */
function initializeCsSdk(context: TelemetryContext): void {
  // Only touch window.EkTelemetry here, scoped to a real context — never when
  // isEmptyContext() short-circuits (see initializeTelemetry below), so this
  // has no effect on hosts that inject/remove their own EkTelemetry with no
  // context, and no effect on the bridge-only test suite.
  loadLegacyTelemetrySdk();
  const contentSessionId = generateID();
  const playSessionId = generateID();
  // TelemetryContext's index signature allows any type for unknown keys — a
  // truthy non-array (e.g. a host accidentally passing an object/string)
  // would throw on .concat() or produce an invalid cdata, so gate explicitly.
  const cdata = (Array.isArray(context.cdata) ? context.cdata : []).concat([
    { id: contentSessionId, type: 'ContentSession' },
    { id: playSessionId, type: 'PlaySession' },
    { id: '2.0', type: 'PlayerVersion' },
  ]);
  // The legacy engine's own dispatch (TelemetrySyncManager.syncEvents) reads
  // `Telemetry.config.pdata.id` unconditionally, with no null guard — an
  // undefined pdata throws there and silently kills the whole batch flush.
  // Real hosts (portal/mobile) always send one; default defensively in case
  // a host (or this project's own dev harness) doesn't.
  const pdata = context.pdata || { id: '', ver: '1.0' };

  csEventOptions = {
    object: {
      // Portal's telemetryContextBuilder.ts names this field `contentId`, not
      // `identifier` — reading the wrong key here silently left object.id
      // empty on every event (START/ASSESS/END/etc), not just END.
      id: (context.contentId as string) || '',
      type: 'Content',
      // pkgVersion is a number in raw content metadata (Angular parity:
      // quml-library.service.ts reads parentConfig.metadata.pkgVersion, not
      // telemetry context) — stringify rather than assume a string.
      ver: context.pkgVersion != null ? String(context.pkgVersion) : '',
      rollup: context.objectRollup || {},
    },
    context: {
      channel: context.channel || '',
      pdata,
      env: 'contentplayer',
      sid: context.sid,
      uid: context.uid,
      cdata,
      // Portal's telemetryContextBuilder.ts names this field `contextRollup`,
      // not `rollup` — same field-name mismatch class as object.id/contentId.
      rollup: (context.contextRollup as Record<string, string>) || {},
    },
  };

  if (!CsTelemetryModule.instance.isInitialised && !csSdkInitInFlight) {
    csSdkInitInFlight = true;
    const telemetryConfig = {
      pdata,
      env: 'contentplayer',
      channel: context.channel,
      did: context.did,
      authtoken: (context.authToken as string) || '',
      uid: context.uid || '',
      sid: context.sid,
      batchsize: 20,
      mode: context.mode,
      host: context.host || '',
      // The legacy engine builds its request URL as `host + apislug + endpoint`
      // (TelemetrySyncManager.syncEvents). Its own built-in default for
      // apislug is '/action' (Telemetry._defaultValue.apislug) — the real
      // gateway prefix, matching the portal's own documented convention
      // (telemetryContextBuilder.ts: "apislug=/action => /action +
      // /data/v3/telemetry"). Neither the portal nor Angular's own
      // quml-library.service.ts ever sets context.apislug — they rely on this
      // SDK default. Passing `apislug: ''` here (even as a fallback) would
      // still overwrite that default via Object.assign(_defaultValue, config),
      // since the key would always be present — so OMIT the key entirely
      // unless the host explicitly provides one, letting the SDK default flow
      // through untouched.
      ...(context.apislug ? { apislug: context.apislug as string } : {}),
      endpoint: (context.endpoint as string) || '/data/v3/telemetry',
      tags: context.tags,
      cdata,
    };

    CsTelemetryModule.instance
      .init({})
      .then(() => {
        CsTelemetryModule.instance.telemetryService.initTelemetry({
          config: telemetryConfig,
          userOrgDetails: {},
        });
      })
      .catch((error: unknown) => {
        csSdkInitInFlight = false;
        console.warn('[TelemetryService] CS SDK init failed', error);
      });
  }
}

/** Initialize the telemetry SDK(s) — both the host-injected bridge and the CS SDK. */
export function initializeTelemetry(context: TelemetryContext): void {
  // Run BEFORE reading window.EkTelemetry below: for a real (non-empty)
  // context, this may synchronously inject the legacy engine, so the bridge
  // check right after picks it up in the same call rather than one call late.
  const usingCsSdk = !isEmptyContext(context);
  if (usingCsSdk) {
    initializeCsSdk(context);
  } else {
    csEventOptions = null;
  }

  const sdk = typeof window !== 'undefined' ? (window as any).EkTelemetry : undefined;
  // Always reflect the CURRENT global SDK (or its absence). Otherwise a stale
  // reference from a prior init can linger (multi-instance / tests) and receive
  // logEvent calls after EkTelemetry is gone.
  telemetrySDK = sdk ?? null;
  if (sdk) {
    // Guard: not every host SDK exposes `initialize` (or it may already be
    // initialized by the host). Never assume the method exists.
    //
    // Skip this bare call entirely when the CS SDK is active (usingCsSdk):
    // `initializeCsSdk` above already drives the SAME underlying engine via
    // `CsTelemetryModule...initTelemetry(...)`, with a complete, correctly
    // defaulted config (pdata/apislug/batchsize/etc). The legacy engine's own
    // `init()` no-ops after the first successful call ("Telemetry is already
    // initialized.."), so calling BOTH races: this bare call runs
    // synchronously with only the raw context (no pdata/apislug), while the CS
    // SDK's call is deferred behind an async `.init({})` — whichever fires
    // first wins for the rest of the page's lifetime. Letting this bare call
    // win silently drops pdata/apislug/etc and breaks every subsequent batch
    // flush ("Cannot read properties of undefined (reading 'id')").
    if (!usingCsSdk && typeof sdk.initialize === 'function') {
      sdk.initialize(context);
    }
  } else {
    console.warn('[TelemetryService] Sunbird SDK not available');
  }
}

/**
 * Deliver an event to the global SDK if — and only if — it exposes a usable
 * `logEvent`. Many hosts (portal/editor) DON'T: they consume telemetry via the
 * `subscribeTelemetry` bridge (see emit) and their SDK has no `logEvent`. Calling
 * it blindly throws "logEvent is not a function" on every interaction, so we
 * feature-detect first. Returns true if the SDK accepted it.
 */
function sendToSdk(event: TelemetryEvent): boolean {
  if (telemetrySDK && typeof telemetrySDK.logEvent === 'function') {
    telemetrySDK.logEvent(event);
    return true;
  }
  // Queue ONLY while no SDK is present yet — it may initialize later and flush.
  // If an SDK IS present but has no logEvent (portal/editor consume via the
  // subscribeTelemetry bridge), never queue: flushQueuedEvents also requires
  // logEvent, so the queue could never drain and would grow unbounded.
  if (!telemetrySDK) {
    eventQueue.push(event);
  }
  return false;
}

/** Raise an INTERACT event (user action). */
export function raiseInteractEvent(data: unknown): void {
  const event: TelemetryEvent = { eid: 'INTERACT', edata: data, timestamp: Date.now() };
  sendToSdk(event);
  emit(event);
  if (csEventOptions) {
    CsTelemetryModule.instance.telemetryService.raiseInteractTelemetry({
      options: csEventOptions,
      edata: data,
    });
  }
}

/** Raise an ASSESS event (answer submission). */
export function raiseAssessEvent(data: unknown): void {
  const event: TelemetryEvent = { eid: 'ASSESS', edata: data, timestamp: Date.now() };
  sendToSdk(event);
  emit(event);
  if (csEventOptions) {
    CsTelemetryModule.instance.telemetryService.raiseAssesTelemetry(data, csEventOptions);
  }
}

/** Raise an IMPRESSION event (page view). */
export function raiseImpressionEvent(data: unknown): void {
  const event: TelemetryEvent = { eid: 'IMPRESSION', edata: data, timestamp: Date.now() };
  sendToSdk(event);
  emit(event);
  if (csEventOptions) {
    CsTelemetryModule.instance.telemetryService.raiseImpressionTelemetry({
      options: csEventOptions,
      edata: data,
    });
  }
}

/** Raise a START event (assessment begins). */
export function raiseStartEvent(data: unknown): void {
  const event: TelemetryEvent = { eid: 'START', edata: data, timestamp: Date.now() };
  sendToSdk(event);
  emit(event);
  if (csEventOptions) {
    CsTelemetryModule.instance.telemetryService.raiseStartTelemetry({
      options: csEventOptions,
      edata: data,
    });
  }
}

/** Raise an END event (assessment submitted). */
export function raiseEndEvent(data: unknown): void {
  const event: TelemetryEvent = { eid: 'END', edata: data, timestamp: Date.now() };
  sendToSdk(event);
  emit(event);
  if (csEventOptions) {
    CsTelemetryModule.instance.telemetryService.raiseEndTelemetry({
      options: csEventOptions,
      edata: data,
    });
  }
}

/** Raise a SUMMARY event (score breakdown). */
export function raiseSummaryEvent(data: unknown): void {
  const event: TelemetryEvent = { eid: 'SUMMARY', edata: data, timestamp: Date.now() };
  sendToSdk(event);
  emit(event);
  if (csEventOptions) {
    CsTelemetryModule.instance.telemetryService.raiseSummaryTelemetry(data, csEventOptions);
  }
}

/** Raise an ERROR event. */
export function raiseErrorEvent(data: unknown): void {
  const event: TelemetryEvent = { eid: 'ERROR', edata: data, timestamp: Date.now() };
  sendToSdk(event);
  emit(event);
  if (csEventOptions) {
    CsTelemetryModule.instance.telemetryService.raiseErrorTelemetry({
      options: csEventOptions,
      edata: data,
    });
  }
}

/**
 * Raise a RESPONSE event (Angular parity: viewer-service.ts:raiseResponseEvent,
 * called from section-player.component.ts's nextSlide() for the question being
 * LEFT, not the one just answered — distinct from ASSESS).
 */
export function raiseResponseEvent(data: unknown): void {
  const event: TelemetryEvent = { eid: 'RESPONSE', edata: data, timestamp: Date.now() };
  sendToSdk(event);
  emit(event);
  if (csEventOptions) {
    CsTelemetryModule.instance.telemetryService.raiseResponseTelemetry(data, csEventOptions);
  }
}

/** Get queued events (useful for testing or delayed SDK init). */
export function getQueuedEvents(): TelemetryEvent[] {
  return [...eventQueue];
}

/** Clear the event queue. */
export function clearEventQueue(): void {
  eventQueue = [];
}

/** Reset the CS SDK envelope (test-only escape hatch; mirrors clearEventQueue). */
export function clearCsTelemetryOptions(): void {
  csEventOptions = null;
  csSdkInitInFlight = false;
}

/** Flush queued events to the SDK (only if it exposes a usable logEvent). */
export function flushQueuedEvents(): void {
  if (telemetrySDK && typeof telemetrySDK.logEvent === 'function' && eventQueue.length > 0) {
    eventQueue.forEach((event) => {
      telemetrySDK.logEvent(event);
    });
    eventQueue = [];
  }
}
