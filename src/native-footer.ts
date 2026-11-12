export const NATIVE_FOOTER_DIRECTIVE = '-opencode.prompt.footer';

export function hasNativeFooterDirective(plugins: readonly unknown[] | undefined): boolean {
    return plugins?.includes(NATIVE_FOOTER_DIRECTIVE) ?? false;
}

export function withNativeFooterDirective(plugins: readonly unknown[] | undefined, hidden: boolean): unknown[] {
    const rest = (plugins ?? []).filter((entry) => entry !== NATIVE_FOOTER_DIRECTIVE);
    return hidden ? [NATIVE_FOOTER_DIRECTIVE, ...rest] : rest;
}
