import { describe, expect, test } from 'bun:test';
import { DEFAULT_PLACEMENT, PLACEMENTS, isPlacement, nextPlacement, normalizePlacement } from './placement';

describe('placement', () => {
    test('recognises supported placements', () => {
        for (const placement of PLACEMENTS) expect(isPlacement(placement.id)).toBe(true);
        expect(isPlacement('nope')).toBe(false);
        expect(isPlacement(undefined)).toBe(false);
        expect(isPlacement(3)).toBe(false);
    });

    test('falls back to the default for invalid values', () => {
        expect(normalizePlacement(undefined)).toBe(DEFAULT_PLACEMENT);
        expect(normalizePlacement('nope')).toBe(DEFAULT_PLACEMENT);
        expect(normalizePlacement('overlay')).toBe('overlay');
        expect(normalizePlacement('footer')).toBe('footer');
        expect(normalizePlacement('footer-compact')).toBe('footer-compact');
        expect(normalizePlacement('composer')).toBe('composer');
    });

    test('cycles through every placement and wraps', () => {
        expect(nextPlacement('composer')).toBe('overlay');
        expect(nextPlacement('overlay')).toBe('footer');
        expect(nextPlacement('footer')).toBe('footer-compact');
        expect(nextPlacement('footer-compact')).toBe('composer');
    });
});
