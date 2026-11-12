import { describe, expect, test } from 'bun:test';
import type { ModelInfo, SessionMessageAssistant, SessionMessageInfo, TokenUsageInfo } from '@opencode/client';
import { contextUsage, findModel, lastAssistantWithUsage, sumTokens } from './stats';

interface ModelOptions {
    id?: string;
    modelID?: string;
    providerID?: string;
    context?: number;
}

const model = ({
    id = 'model',
    modelID = id,
    providerID = 'provider',
    context = 200_000,
}: ModelOptions = {}): ModelInfo => ({
    id,
    modelID,
    providerID,
    name: id,
    capabilities: { tools: true, input: ['text'], output: ['text'] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: 'active',
    enabled: true,
    limit: { context, output: 8_000 },
});

const usage = (input = 0, output = 0, reasoning = 0, cacheRead = 0, cacheWrite = 0): TokenUsageInfo => ({
    input,
    output,
    reasoning,
    cache: { read: cacheRead, write: cacheWrite },
});

const assistant = (
    id: string,
    tokens: TokenUsageInfo | undefined,
    ref: { id: string; providerID: string } = { id: 'model', providerID: 'provider' },
): SessionMessageAssistant => ({
    id,
    type: 'assistant',
    time: { created: 0 },
    agent: 'build',
    model: ref,
    content: [],
    tokens,
});

const user = (id: string): SessionMessageInfo => ({
    id,
    type: 'user',
    time: { created: 0 },
    text: '',
});

const compaction = (id: string): SessionMessageInfo => ({
    id,
    type: 'compaction',
    time: { created: 0 },
    status: 'completed',
    reason: 'auto',
    summary: '',
});

const runningCompaction = (id: string): SessionMessageInfo => ({
    id,
    type: 'compaction',
    time: { created: 0 },
    status: 'running',
    reason: 'auto',
    summary: '',
});

describe('sumTokens', () => {
    test('returns all zeroes without usage', () => {
        expect(sumTokens(undefined)).toEqual({
            input: 0,
            output: 0,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
        });
    });

    test('copies every token field and includes cache in the total', () => {
        expect(sumTokens(usage(100, 50, 25, 1_000, 5))).toEqual({
            input: 100,
            output: 50,
            reasoning: 25,
            cacheRead: 1_000,
            cacheWrite: 5,
            total: 1_180,
        });
    });
});

describe('findModel', () => {
    test('returns undefined without models or a reference', () => {
        expect(findModel(undefined, { providerID: 'provider', id: 'model' })).toBeUndefined();
        expect(findModel([model()], undefined)).toBeUndefined();
    });

    test('matches by provider and model id', () => {
        const found = model({ id: 'model-id', modelID: 'provider/model-id' });
        expect(findModel([found], { providerID: 'provider', id: 'model-id' })).toBe(found);
    });

    test('matches by provider and modelID', () => {
        const found = model({ id: 'model-id', modelID: 'provider/model-id' });
        expect(findModel([found], { providerID: 'provider', id: 'provider/model-id' })).toBe(found);
    });

    test('requires both the provider and the model to match', () => {
        expect(findModel([model()], { providerID: 'other', id: 'model' })).toBeUndefined();
        expect(findModel([model()], { providerID: 'provider', id: 'other' })).toBeUndefined();
    });
});

describe('lastAssistantWithUsage', () => {
    test('returns undefined without messages', () => {
        expect(lastAssistantWithUsage([])).toBeUndefined();
    });

    test('returns the most recent assistant with usage', () => {
        const messages: SessionMessageInfo[] = [assistant('a', usage(10)), user('u'), assistant('b', usage(20))];
        const found = lastAssistantWithUsage(messages);
        expect(found?.id).toBe('b');
        expect(found?.tokens).toEqual(usage(20));
    });

    test('skips assistant messages without usage', () => {
        const messages: SessionMessageInfo[] = [assistant('a', usage(10)), assistant('b', undefined)];
        expect(lastAssistantWithUsage(messages)?.id).toBe('a');
    });

    test('stops before a boundary message', () => {
        const messages: SessionMessageInfo[] = [
            assistant('a', usage(10)),
            user('b'),
            assistant('c', usage(20)),
            assistant('d', usage(30)),
        ];
        expect(lastAssistantWithUsage(messages, 'b')?.id).toBe('a');
        expect(lastAssistantWithUsage(messages, 'c')?.id).toBe('a');
        expect(lastAssistantWithUsage(messages, 'd')?.id).toBe('c');
        expect(lastAssistantWithUsage(messages, 'missing')).toBeUndefined();
        expect(lastAssistantWithUsage(messages, 'a')).toBeUndefined();
    });

    test('uses the last completed compaction as a lower bound', () => {
        const messages: SessionMessageInfo[] = [
            assistant('a', usage(10)),
            compaction('compact-1'),
            assistant('b', usage(20)),
            compaction('compact-2'),
            assistant('c', usage(30)),
        ];
        expect(lastAssistantWithUsage(messages)?.id).toBe('c');
    });

    test('returns undefined when no assistant follows the last compaction', () => {
        const messages: SessionMessageInfo[] = [
            assistant('a', usage(10)),
            compaction('compact-1'),
            assistant('b', usage(20)),
            compaction('compact-2'),
        ];
        expect(lastAssistantWithUsage(messages)).toBeUndefined();
    });

    test('ignores compactions that are not completed', () => {
        const messages: SessionMessageInfo[] = [
            assistant('a', usage(10)),
            runningCompaction('compact-running'),
            assistant('b', usage(20)),
        ];
        expect(lastAssistantWithUsage(messages)?.id).toBe('b');
    });

    test('applies the boundary before looking for compaction', () => {
        const messages: SessionMessageInfo[] = [
            assistant('a', usage(10)),
            compaction('compact'),
            assistant('b', usage(20)),
        ];
        expect(lastAssistantWithUsage(messages, 'compact')?.id).toBe('a');
        expect(lastAssistantWithUsage(messages, 'b')).toBeUndefined();
    });
});

describe('contextUsage', () => {
    test('returns undefined without an assistant that has usage', () => {
        expect(contextUsage([], [model()])).toBeUndefined();
        expect(contextUsage([user('u'), assistant('a', undefined)], [model()])).toBeUndefined();
    });

    test('returns undefined when the used token count is not positive', () => {
        const messages: SessionMessageInfo[] = [assistant('a', usage(0, 0, 0, 0, 0))];
        expect(contextUsage(messages, [model()])).toBeUndefined();
    });

    test('returns undefined for a negative or non-finite total', () => {
        expect(contextUsage([assistant('a', usage(-1, 0, 0, 0, 0))], [model()])).toBeUndefined();
        expect(contextUsage([assistant('a', usage(Number.NaN, 0, 0, 0, 0))], [model()])).toBeUndefined();
    });

    test('sums every token field and applies the model context limit', () => {
        const messages: SessionMessageInfo[] = [assistant('a', usage(100, 50, 25, 800, 25))];
        expect(contextUsage(messages, [model({ context: 1_000 })])).toEqual({
            used: 1_000,
            limit: 1_000,
            percent: 100,
        });
        expect(contextUsage(messages, [model({ context: 2_000 })])).toEqual({
            used: 1_000,
            limit: 2_000,
            percent: 50,
        });
    });

    test('omits the percentage without a matching model or positive limit', () => {
        const messages: SessionMessageInfo[] = [assistant('a', usage(100))];

        const missing = contextUsage(messages, [model({ providerID: 'other' })]);
        expect(missing?.used).toBe(100);
        expect(missing?.limit).toBeUndefined();
        expect(missing?.percent).toBeUndefined();

        const zero = contextUsage(messages, [model({ context: 0 })]);
        expect(zero?.used).toBe(100);
        expect(zero?.limit).toBe(0);
        expect(zero?.percent).toBeUndefined();
    });

    test('respects a boundary', () => {
        const messages: SessionMessageInfo[] = [assistant('a', usage(100)), assistant('b', usage(200))];
        expect(contextUsage(messages, [model({ context: 1_000 })], 'b')?.used).toBe(100);
    });

    test('uses usage after the last completed compaction', () => {
        const messages: SessionMessageInfo[] = [
            assistant('old', usage(100)),
            compaction('compact'),
            assistant('new', usage(200)),
        ];
        expect(contextUsage(messages, [model({ context: 1_000 })])?.used).toBe(200);
    });
});
