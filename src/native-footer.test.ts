import { describe, expect, test } from 'bun:test';
import { NATIVE_FOOTER_DIRECTIVE, hasNativeFooterDirective, withNativeFooterDirective } from './native-footer';

describe('native footer directive', () => {
    test('detects the disable directive', () => {
        expect(hasNativeFooterDirective([NATIVE_FOOTER_DIRECTIVE])).toBe(true);
        expect(hasNativeFooterDirective(['oc-tps@latest', NATIVE_FOOTER_DIRECTIVE])).toBe(true);
        expect(hasNativeFooterDirective(['oc-tps@latest'])).toBe(false);
        expect(hasNativeFooterDirective([])).toBe(false);
        expect(hasNativeFooterDirective(undefined)).toBe(false);
    });

    test('adds the directive at the front without duplicating it', () => {
        expect(withNativeFooterDirective(['oc-tps@latest'], true)).toEqual([NATIVE_FOOTER_DIRECTIVE, 'oc-tps@latest']);
        expect(withNativeFooterDirective([NATIVE_FOOTER_DIRECTIVE, 'oc-tps@latest'], true)).toEqual([
            NATIVE_FOOTER_DIRECTIVE,
            'oc-tps@latest',
        ]);
        expect(withNativeFooterDirective(undefined, true)).toEqual([NATIVE_FOOTER_DIRECTIVE]);
    });

    test('removes the directive while preserving other entries, including objects', () => {
        const plugin = { package: 'file:///home/maston/opencode-token-stats', options: {} };
        expect(withNativeFooterDirective([NATIVE_FOOTER_DIRECTIVE, plugin, 'oc-tps@latest'], false)).toEqual([
            plugin,
            'oc-tps@latest',
        ]);
        expect(withNativeFooterDirective([NATIVE_FOOTER_DIRECTIVE], false)).toEqual([]);
        expect(withNativeFooterDirective(undefined, false)).toEqual([]);
    });
});
