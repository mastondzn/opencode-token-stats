import type { Plugin } from '@opencode/plugin/tui';
import { createSignal } from 'solid-js';

type Context = Plugin.Context;

export const STREAM_WINDOW_MS = 5000;
export const LIVE_STALE_MS = 1500;
export const SINGLE_SAMPLE_MS = 1000;
export const BYTES_PER_TOKEN = 4;

export interface Sample {
    readonly at: number;
    readonly tokens: number;
}

export interface LastMeasurement {
    readonly tps?: number;
    readonly ttftMs?: number;
}

export interface AverageMeasurement {
    readonly totalTokens: number;
    readonly totalDurationMs: number;
    readonly totalTtftMs: number;
    readonly stepCount: number;
}

export interface Tracker {
    readonly revision: () => number;
    liveTps(sessionID: string, now?: number): number | undefined;
    displayTps(sessionID: string, now?: number): number | undefined;
    currentTtftMs(sessionID: string): number | undefined;
    averageTps(sessionID: string): number | undefined;
    averageTtftMs(sessionID: string): number | undefined;
    dispose(): void;
}

interface Timing {
    readonly sessionID: string;
    readonly requestStartAt: number;
    readonly startedAt?: number;
    firstResponseAt?: number;
    lastToolCallAt?: number;
}

const encoder = new TextEncoder();

export function estimateTokens(delta: string, bytesPerToken?: number): number {
    return Math.max(1, Math.ceil(encoder.encode(delta).length / (bytesPerToken ?? BYTES_PER_TOKEN)));
}

export function activeDuration(samples: readonly Sample[], tailAt?: number): number {
    if (samples.length === 0) return 0;

    if (samples.length === 1) {
        const sample = samples[0]!;
        const duration =
            tailAt === undefined ? SINGLE_SAMPLE_MS : Math.min(Math.max(tailAt - sample.at, 250), SINGLE_SAMPLE_MS);
        return Math.max(duration, 0);
    }

    let duration = 0;
    for (let index = 1; index < samples.length; index++) {
        const previous = samples[index - 1]!;
        const current = samples[index]!;
        duration += Math.max(current.at - previous.at, 0);
    }

    if (tailAt !== undefined) {
        duration += Math.max(tailAt - samples[samples.length - 1]!.at, 0);
    }

    return Math.max(duration, SINGLE_SAMPLE_MS);
}

export function liveRate(
    samples: readonly Sample[],
    now: number,
    windowMs = STREAM_WINDOW_MS,
    staleMs = LIVE_STALE_MS,
): number | undefined {
    const filtered = samples.filter((sample) => now - sample.at <= windowMs);
    const last = filtered.at(-1);
    if (!last) return undefined;
    if (now - last.at > staleMs) return undefined;

    const tokens = filtered.reduce((total, sample) => total + sample.tokens, 0);
    const duration = activeDuration(filtered, now);
    if (duration <= 0) return undefined;

    return tokens / (duration / 1000);
}

function pruneSamples(samples: Record<string, Sample[]>, now: number): boolean {
    let remaining = false;

    for (const sessionID of Object.keys(samples)) {
        const kept = samples[sessionID]!.filter((sample) => now - sample.at <= STREAM_WINDOW_MS);

        if (kept.length === 0) {
            delete samples[sessionID];
        } else {
            samples[sessionID] = kept;
            remaining = true;
        }
    }

    return remaining;
}

export function createTracker(context: Context): Tracker {
    const [revision, setRevision] = createSignal(0);
    const bump = () => setRevision((value) => value + 1);

    const samples: Record<string, Sample[]> = {};
    const requestStarts: Record<string, number> = {};
    const timings: Record<string, Timing> = {};
    const last: Record<string, LastMeasurement> = {};
    const averages: Record<string, AverageMeasurement> = {};
    const currentTtft: Record<string, number> = {};

    const appendSample = (sessionID: string, _assistantMessageID: string, delta: string, at: number) => {
        const list = samples[sessionID] ?? (samples[sessionID] = []);
        list.push({ at, tokens: estimateTokens(delta) });
    };

    const markFirstResponse = (sessionID: string, assistantMessageID: string, at: number) => {
        const timing = timings[assistantMessageID] ?? (timings[assistantMessageID] = { sessionID, requestStartAt: at });

        if (timing.firstResponseAt === undefined) {
            timing.firstResponseAt = at;
            currentTtft[sessionID] = Math.max(timing.firstResponseAt - timing.requestStartAt, 0);
        }
    };

    const unsubscribers = [
        context.data.on('session.execution.started', (event) => {
            requestStarts[event.data.sessionID] = event.created;
            bump();
        }),
        context.data.on('session.step.started', (event) => {
            const sessionID = event.data.sessionID;
            const requestStartAt = requestStarts[sessionID] ?? event.created;
            timings[event.data.assistantMessageID] = {
                sessionID,
                requestStartAt,
                startedAt: event.data.started,
            };
            delete requestStarts[sessionID];
            delete currentTtft[sessionID];
            bump();
        }),
        context.data.on('session.text.delta', (event) => {
            const sessionID = event.data.sessionID;
            appendSample(sessionID, event.data.assistantMessageID, event.data.delta, event.created);
            markFirstResponse(sessionID, event.data.assistantMessageID, event.created);
            if (samples[sessionID]) {
                samples[sessionID] = samples[sessionID]!.filter(
                    (sample) => event.created - sample.at <= STREAM_WINDOW_MS,
                );
            }
            bump();
        }),
        context.data.on('session.reasoning.delta', (event) => {
            const sessionID = event.data.sessionID;
            appendSample(sessionID, event.data.assistantMessageID, event.data.delta, event.created);
            markFirstResponse(sessionID, event.data.assistantMessageID, event.created);
            if (samples[sessionID]) {
                samples[sessionID] = samples[sessionID]!.filter(
                    (sample) => event.created - sample.at <= STREAM_WINDOW_MS,
                );
            }
            bump();
        }),
        context.data.on('session.tool.input.started', (event) => {
            const sessionID = event.data.sessionID;
            delete samples[sessionID];
            const timing = timings[event.data.assistantMessageID];
            if (timing) {
                const firstResponseAt = (timing.firstResponseAt ??= event.created);
                currentTtft[sessionID] = Math.max(firstResponseAt - timing.requestStartAt, 0);
            }
            bump();
        }),
        context.data.on('session.tool.called', (event) => {
            const timing = timings[event.data.assistantMessageID];
            if (timing) timing.lastToolCallAt = event.created;
            bump();
        }),
        context.data.on('session.step.ended', (event) => {
            const sessionID = event.data.sessionID;
            const timing = timings[event.data.assistantMessageID];

            if (timing?.firstResponseAt !== undefined) {
                const tokens = event.data.tokens.output + event.data.tokens.reasoning;
                const endAt =
                    event.data.finish === 'tool-calls' ? (timing.lastToolCallAt ?? event.created) : event.created;
                const duration = Math.max(endAt - timing.firstResponseAt, 1);

                if (tokens > 0) {
                    const ttftMs = Math.max(timing.firstResponseAt - timing.requestStartAt, 0);
                    last[sessionID] = { tps: tokens / (duration / 1000), ttftMs };

                    const average = averages[sessionID] ?? {
                        totalTokens: 0,
                        totalDurationMs: 0,
                        totalTtftMs: 0,
                        stepCount: 0,
                    };
                    averages[sessionID] = {
                        totalTokens: average.totalTokens + tokens,
                        totalDurationMs: average.totalDurationMs + duration,
                        totalTtftMs: average.totalTtftMs + ttftMs,
                        stepCount: average.stepCount + 1,
                    };
                }
            }

            delete currentTtft[sessionID];
            delete timings[event.data.assistantMessageID];
            delete samples[sessionID];
            bump();
        }),
        context.data.on('session.step.failed', (event) => {
            const sessionID = event.data.sessionID;
            delete timings[event.data.assistantMessageID];
            delete currentTtft[sessionID];
            delete samples[sessionID];
            bump();
        }),
        context.data.on('session.execution.succeeded', (event) => {
            delete requestStarts[event.data.sessionID];
            delete samples[event.data.sessionID];
            bump();
        }),
        context.data.on('session.execution.failed', (event) => {
            delete requestStarts[event.data.sessionID];
            delete samples[event.data.sessionID];
            bump();
        }),
        context.data.on('session.execution.interrupted', (event) => {
            delete requestStarts[event.data.sessionID];
            delete samples[event.data.sessionID];
            bump();
        }),
        context.data.on('session.deleted', (event) => {
            const sessionID = event.data.sessionID;
            delete samples[sessionID];
            delete requestStarts[sessionID];
            delete last[sessionID];
            delete averages[sessionID];
            delete currentTtft[sessionID];

            for (const messageID of Object.keys(timings)) {
                if (timings[messageID]!.sessionID === sessionID) delete timings[messageID];
            }
            bump();
        }),
    ];

    const timer = setInterval(() => {
        if (pruneSamples(samples, Date.now())) bump();
    }, 1000);

    const liveTps = (sessionID: string, now = Date.now()): number | undefined => {
        if (context.data.session.status(sessionID) !== 'running') return undefined;
        return liveRate(samples[sessionID] ?? [], now);
    };

    let disposed = false;

    return {
        revision,
        liveTps,
        displayTps(sessionID, now = Date.now()) {
            return liveTps(sessionID, now) ?? last[sessionID]?.tps;
        },
        currentTtftMs(sessionID) {
            return currentTtft[sessionID] ?? last[sessionID]?.ttftMs;
        },
        averageTps(sessionID) {
            const average = averages[sessionID];
            if (!average || average.stepCount === 0 || average.totalDurationMs <= 0) {
                return undefined;
            }
            return average.totalTokens / (average.totalDurationMs / 1000);
        },
        averageTtftMs(sessionID) {
            const average = averages[sessionID];
            if (!average || average.stepCount === 0) return undefined;
            return average.totalTtftMs / average.stepCount;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const unsubscribe of unsubscribers) unsubscribe();
            clearInterval(timer);
        },
    };
}
