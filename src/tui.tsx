import { Plugin } from '@opencode/plugin/tui';
import type { BoxRenderable, RGBA } from '@opentui/core';
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    For,
    Match,
    Show,
    Switch,
    createEffect,
    createMemo,
    createSignal,
    on,
    onCleanup,
    onMount,
    type Accessor,
} from 'solid-js';
import type { Store } from 'solid-js/store';
import type { Tone } from './format';
import {
    DEFAULT_SEGMENTS,
    SEGMENTS,
    SEGMENT_IDS,
    buildLine,
    fitLine,
    lineWidth,
    normalizeSegments,
    type SegmentId,
} from './segments';
import { PLACEMENTS, normalizePlacement, type Placement } from './placement';
import { hasNativeFooterDirective, withNativeFooterDirective } from './native-footer';
import { contextUsage, type StatsSnapshot } from './stats';
import { createTracker, type Tracker } from './tracker';

type Context = Plugin.Context;

type Settings = { segments: SegmentId[]; placement: Placement };
type Baseline = { segments: SegmentId[]; placement: Placement };
type SettingsStore = Store<Settings>;
type UpdateSettings = (mutation: (draft: Settings) => void) => Promise<void>;

const PLUGIN_ID = 'mastondzn.token-stats';
const STORE_KEY = 'settings';
const COMMAND_ID = 'mastondzn.token-stats.configure';

function cliConfigPath(): string {
    const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    return join(base, 'opencode', 'cli.json');
}

function isMissingFile(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'ENOENT'
    );
}

function readCliConfig(): { config?: Record<string, unknown>; error?: string } {
    const path = cliConfigPath();
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { error: `${path} is not a JSON object` };
        }
        return { config: parsed as Record<string, unknown> };
    } catch (error) {
        if (isMissingFile(error)) return { config: {} };
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

function effectivePlugins(): unknown[] | undefined {
    const inline = process.env.OPENCODE_CLI_CONFIG_CONTENT;
    if (inline) {
        try {
            const parsed = JSON.parse(inline);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const plugins = (parsed as Record<string, unknown>).plugins;
                if (Array.isArray(plugins)) return plugins;
            }
        } catch {
            // Fall back to the file when the inline override is unreadable.
        }
    }
    const plugins = readCliConfig().config?.plugins;
    return Array.isArray(plugins) ? plugins : undefined;
}

function isNativeFooterHidden(): boolean {
    return hasNativeFooterDirective(effectivePlugins());
}

function writeNativeFooterSetting(hidden: boolean): { ok: true } | { ok: false; error: string } {
    const inline = process.env.OPENCODE_CLI_CONFIG_CONTENT;
    if (inline) {
        try {
            const parsed = JSON.parse(inline);
            if (
                parsed &&
                typeof parsed === 'object' &&
                !Array.isArray(parsed) &&
                Array.isArray((parsed as Record<string, unknown>).plugins)
            ) {
                return {
                    ok: false,
                    error: 'OPENCODE_CLI_CONFIG_CONTENT overrides cli.json. Unset it or edit its plugins array directly.',
                };
            }
        } catch {
            // Let the file update proceed when the inline override is unreadable.
        }
    }

    const path = cliConfigPath();
    const read = readCliConfig();
    if (read.error) return { ok: false, error: `Could not read ${path}: ${read.error}` };

    const config = read.config ?? {};
    const plugins = Array.isArray(config.plugins) ? config.plugins : undefined;
    config.plugins = withNativeFooterDirective(plugins, hidden);
    const text = `${JSON.stringify(config, null, 2)}\n`;

    let mode: number | undefined;
    try {
        mode = statSync(path).mode & 0o777;
    } catch {
        // New file; leave the default mode.
    }

    try {
        mkdirSync(dirname(path), { recursive: true });
        const temporary = `${path}.tmp`;
        writeFileSync(temporary, text);
        if (mode !== undefined) chmodSync(temporary, mode);
        renameSync(temporary, path);
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

export default Plugin.define({
    id: PLUGIN_ID,
    setup(context) {
        const baseline: Baseline = {
            segments: normalizeSegments(context.options.segments) ?? [...DEFAULT_SEGMENTS],
            placement: normalizePlacement(context.options.placement),
        };
        const [settings, updateSettings] = context.storage.store<Settings>(STORE_KEY, {
            initial: { segments: [...baseline.segments], placement: baseline.placement },
        });
        const tracker = createTracker(context);
        const [nativeFooterHidden, setNativeFooterHidden] = createSignal(isNativeFooterHidden());

        let layerRegistered = false;
        const unregisterApp = context.ui.slot({
            append: 'app',
            render: () => {
                if (layerRegistered) return null;
                layerRegistered = true;
                context.keymap.layer(() => ({
                    mode: 'global',
                    commands: [
                        {
                            id: COMMAND_ID,
                            title: 'Token stats: Configure',
                            group: 'Token stats',
                            palette: true,
                            slash: { name: 'token-stats', aliases: ['tokens'] },
                            run: () =>
                                configure(context, settings, updateSettings, baseline, nativeFooterHidden, (hidden) =>
                                    setNativeFooterHidden(hidden),
                                ),
                        },
                        {
                            id: 'mastondzn.token-stats.placement',
                            title: 'Token stats: Placement',
                            group: 'Token stats',
                            palette: true,
                            run: () => configurePlacement(context, settings, updateSettings, baseline),
                        },
                    ],
                }));
                return null;
            },
        });

        const unregisterComposer = context.ui.slot({
            append: 'session.composer.top',
            render: (input) => (
                <TokenStatsComposer
                    context={context}
                    sessionID={input.sessionID}
                    settings={settings}
                    baseline={baseline}
                    tracker={tracker}
                />
            ),
        });

        const unregisterFooter = context.ui.slot({
            append: 'prompt.footer.status',
            render: (input) => (
                <TokenStatsSlot
                    context={context}
                    sessionID={input.sessionID}
                    mode={input.mode}
                    settings={settings}
                    baseline={baseline}
                    tracker={tracker}
                />
            ),
        });

        const unregisterOverlay = context.ui.slot({
            append: 'prompt.footer',
            render: (input) => (
                <TokenStatsOverlay
                    context={context}
                    sessionID={input.sessionID}
                    mode={input.mode}
                    settings={settings}
                    baseline={baseline}
                    tracker={tracker}
                />
            ),
        });

        const unregisterNativeFooter = context.ui.slot({
            append: 'prompt.footer',
            render: (input) => (
                <Show when={nativeFooterHidden()}>
                    <NativeFooterExtras
                        context={context}
                        sessionID={input.sessionID}
                        mode={input.mode}
                        showDetails={input.showDetails}
                    />
                </Show>
            ),
        });

        return () => {
            unregisterApp();
            unregisterComposer();
            unregisterFooter();
            unregisterOverlay();
            unregisterNativeFooter();
            tracker.dispose();
        };
    },
});

type SegmentChoice = SegmentId | '__reset__';
type ConfigureChoice = `placement:${Placement}` | 'segments' | 'native-footer' | 'reset';

function placementChoices(current: Placement) {
    return PLACEMENTS.map((placement) => ({
        title: placement.label,
        value: placement.id,
        description: placement.description,
        footer: placement.id === current ? 'current' : undefined,
    }));
}

async function configure(
    context: Context,
    settings: SettingsStore,
    updateSettings: UpdateSettings,
    baseline: Baseline,
    nativeFooterHidden: () => boolean,
    setNativeFooterHidden: (hidden: boolean) => void,
) {
    const currentPlacement = normalizePlacement(settings.placement ?? baseline.placement);
    const enabled = normalizeSegments(settings.segments) ?? [...baseline.segments];

    const choice = await context.ui.dialog.select<ConfigureChoice>({
        title: 'Token stats',
        placeholder: 'Configure token stats',
        current: `placement:${currentPlacement}`,
        options: [
            ...placementChoices(currentPlacement).map((option) => ({
                ...option,
                value: `placement:${option.value}` as ConfigureChoice,
                category: 'Placement',
            })),
            {
                title: 'Segments',
                value: 'segments',
                description: `${enabled.length} of ${SEGMENT_IDS.length} enabled`,
                category: 'Stats',
                footer: 'configure',
            },
            {
                title: 'Native footer block',
                value: 'native-footer',
                description: nativeFooterHidden()
                    ? 'Hidden: no native context/cost, subagent/shell, ctrl+p hint, or goal'
                    : 'Shows native context/cost, subagent/shell, ctrl+p hint and goal',
                category: 'Layout',
                footer: nativeFooterHidden() ? 'off' : 'on',
            },
            {
                title: 'Reset to cli.json baseline',
                value: 'reset',
                description: 'Restore placement and segment selection',
                category: 'Actions',
            },
        ],
    });

    if (choice === undefined) return;
    if (choice === 'segments') {
        await configureSegments(context, settings, updateSettings, baseline);
        return;
    }
    if (choice === 'native-footer') {
        await configureNativeFooter(context, nativeFooterHidden(), setNativeFooterHidden);
        return;
    }
    if (choice === 'reset') {
        await updateSettings((draft) => {
            draft.placement = baseline.placement;
            draft.segments = [...baseline.segments];
        });
        return;
    }

    const placement = normalizePlacement(choice.slice('placement:'.length));
    await updateSettings((draft) => {
        draft.placement = placement;
    });
}

async function configurePlacement(
    context: Context,
    settings: SettingsStore,
    updateSettings: UpdateSettings,
    baseline: Baseline,
) {
    const current = normalizePlacement(settings.placement ?? baseline.placement);
    const choice = await context.ui.dialog.select<Placement>({
        title: 'Token stats placement',
        placeholder: 'Choose where the stats line appears',
        current,
        options: placementChoices(current),
    });
    if (choice === undefined) return;
    await updateSettings((draft) => {
        draft.placement = choice;
    });
}

async function configureNativeFooter(context: Context, hidden: boolean, onHiddenChange: (hidden: boolean) => void) {
    const confirmed = await context.ui.dialog.confirm({
        title: hidden ? 'Restore native footer block?' : 'Hide native footer block?',
        message: hidden
            ? 'This removes -opencode.prompt.footer from cli.json and reloads. The native context/cost, subagent/shell, ctrl+p commands, and goal indicators return.'
            : 'This adds -opencode.prompt.footer to cli.json and reloads. The native context/cost, subagent/shell, ctrl+p commands, and goal indicators are removed. This plugin keeps the subagent/shell count and agent hint.',
        label: { confirm: hidden ? 'Restore' : 'Hide', cancel: 'Cancel' },
    });
    if (!confirmed) return;

    const result = writeNativeFooterSetting(!hidden);
    if (!result.ok) {
        await context.ui.dialog.alert({ title: 'Could not update cli.json', message: result.error });
        return;
    }

    onHiddenChange(!hidden);
    context.ui.toast.show({
        message: 'Native footer updated; reloading',
        variant: 'info',
    });
    setTimeout(() => context.keymap.dispatch('location.reload'), 100);
}

async function configureSegments(
    context: Context,
    settings: SettingsStore,
    updateSettings: UpdateSettings,
    baseline: Baseline,
) {
    let focus: SegmentId | undefined;

    while (true) {
        const enabled = normalizeSegments(settings.segments) ?? [...baseline.segments];
        const enabledSet = new Set(enabled);

        const choice = await context.ui.dialog.select<SegmentChoice>({
            title: 'Token stats segments',
            placeholder: 'Search segments',
            current: focus,
            options: [
                ...SEGMENTS.map((segment) => ({
                    title: segment.label,
                    value: segment.id,
                    description: segment.description,
                    category: 'Segments',
                    footer: enabledSet.has(segment.id) ? 'on' : 'off',
                })),
                {
                    title: 'Reset segments',
                    value: '__reset__',
                    description: 'Restore the cli.json segment set',
                    category: 'Actions',
                },
            ],
        });

        if (choice === undefined) return;
        if (choice === '__reset__') {
            await updateSettings((draft) => {
                draft.segments = [...baseline.segments];
            });
            focus = undefined;
            continue;
        }

        focus = choice;
        const current = normalizeSegments(settings.segments) ?? [...baseline.segments];
        const next = current.includes(choice) ? current.filter((id) => id !== choice) : insertSegment(current, choice);

        await updateSettings((draft) => {
            draft.segments = next;
        });
    }
}

function insertSegment(current: SegmentId[], id: SegmentId): SegmentId[] {
    const catalogIndex = SEGMENT_IDS.indexOf(id);
    const next = [...current];
    const at = next.findIndex((existing) => SEGMENT_IDS.indexOf(existing) > catalogIndex);
    if (at === -1) next.push(id);
    else next.splice(at, 0, id);
    return next;
}

function TokenStatsSlot(props: {
    context: Context;
    sessionID: string | undefined;
    mode: 'normal' | 'shell';
    settings: SettingsStore;
    baseline: Baseline;
    tracker: Tracker;
}) {
    const placement = createMemo(() => normalizePlacement(props.settings.placement ?? props.baseline.placement));

    return (
        <Show when={placement() === 'footer' || placement() === 'footer-compact'}>
            <Show when={props.mode === 'normal' ? props.sessionID : undefined}>
                {(sessionID: Accessor<string>) => (
                    <TokenStatsLine
                        context={props.context}
                        sessionID={sessionID()}
                        settings={props.settings}
                        baseline={props.baseline}
                        tracker={props.tracker}
                        fit={placement() === 'footer-compact'}
                    />
                )}
            </Show>
        </Show>
    );
}

function TokenStatsComposer(props: {
    context: Context;
    sessionID: string;
    settings: SettingsStore;
    baseline: Baseline;
    tracker: Tracker;
}) {
    const placement = createMemo(() => normalizePlacement(props.settings.placement ?? props.baseline.placement));

    return (
        <Show when={placement() === 'composer'}>
            <TokenStatsLine
                context={props.context}
                sessionID={props.sessionID}
                settings={props.settings}
                baseline={props.baseline}
                tracker={props.tracker}
                fit
            />
        </Show>
    );
}

function TokenStatsOverlay(props: {
    context: Context;
    sessionID: string | undefined;
    mode: 'normal' | 'shell';
    settings: SettingsStore;
    baseline: Baseline;
    tracker: Tracker;
}) {
    const placement = createMemo(() => normalizePlacement(props.settings.placement ?? props.baseline.placement));

    return (
        <Show when={placement() === 'overlay' && props.mode === 'normal' ? props.sessionID : undefined}>
            {(sessionID: Accessor<string>) => (
                <box position="absolute" right={2} bottom={2} height={1} flexDirection="row">
                    <TokenStatsLine
                        context={props.context}
                        sessionID={sessionID()}
                        settings={props.settings}
                        baseline={props.baseline}
                        tracker={props.tracker}
                        fit={false}
                    />
                </box>
            )}
        </Show>
    );
}

function NativeFooterExtras(props: {
    context: Context;
    sessionID: string | undefined;
    mode: 'normal' | 'shell';
    showDetails: boolean;
}) {
    const theme = props.context.theme;
    const subagents = createMemo(() => {
        if (!props.sessionID) return undefined;
        const count = props.context.data.session
            .family(props.sessionID)
            .filter((id) => id !== props.sessionID && props.context.data.session.status(id) === 'running').length;
        return count ? `${count} subagent${count === 1 ? '' : 's'}` : undefined;
    });
    const shells = createMemo(() => {
        if (!props.sessionID) return undefined;
        const count = props.context.data.shell
            .list(props.context.location)
            .filter((shell) => shell.metadata.sessionID === props.sessionID).length;
        return count ? `${count} shell${count === 1 ? '' : 's'}` : undefined;
    });
    const childShortcut = () => props.context.keymap.shortcuts('session.child.first')[0];
    const agentShortcut = () => props.context.keymap.shortcuts('agent.cycle')[0];

    return (
        <Switch>
            <Match when={props.mode === 'normal'}>
                <Show when={subagents() || shells()}>
                    <box
                        flexShrink={0}
                        onMouseUp={() =>
                            props.context.keymap.dispatch('session.child.first', subagents() ? 'subagents' : 'shell')
                        }
                    >
                        <text fg={theme.text.muted} wrapMode="none">
                            <Show when={childShortcut()}>
                                {(value: Accessor<string>) => <span style={{ fg: theme.text.base }}>{value()} </span>}
                            </Show>
                            <Show when={subagents()}>{(value: Accessor<string>) => <>{value()}</>}</Show>
                            <Show when={subagents() && shells()}> · </Show>
                            <Show when={shells()}>{(value: Accessor<string>) => <>{value()}</>}</Show>
                        </text>
                    </box>
                </Show>
                <Show when={props.showDetails && !subagents() && !shells() && agentShortcut()}>
                    <text fg={theme.text.base} flexShrink={0} wrapMode="none">
                        {agentShortcut()} <span style={{ fg: theme.text.muted }}>agents</span>
                    </text>
                </Show>
            </Match>
            <Match when={props.mode === 'shell'}>
                <text fg={theme.text.base} flexShrink={0} wrapMode="none">
                    esc <span style={{ fg: theme.text.muted }}>exit shell mode</span>
                </text>
            </Match>
        </Switch>
    );
}

function TokenStatsLine(props: {
    context: Context;
    sessionID: string;
    settings: SettingsStore;
    baseline: Baseline;
    tracker: Tracker;
    fit: boolean;
}) {
    const [terminalWidth, setTerminalWidth] = createSignal(props.context.renderer.width);
    const [measuredWidth, setMeasuredWidth] = createSignal<number>();
    const theme = props.context.theme;
    const onResize = (width: number) => setTerminalWidth(width);
    props.context.renderer.on('resize', onResize);
    onCleanup(() => props.context.renderer.off('resize', onResize));

    const session = createMemo(() => props.context.data.session.get(props.sessionID));
    const location = createMemo(
        () => session()?.location ?? props.context.location ?? props.context.data.location.default(),
    );
    const models = createMemo(() => props.context.data.location.model.list(location()) ?? []);
    const messages = createMemo(() => props.context.data.session.message.list(props.sessionID) ?? []);
    const usage = createMemo(() => contextUsage(messages(), models(), session()?.revert?.messageID));

    const syncMessages = () => {
        void props.context.data.session.message.sync(props.sessionID).catch(() => undefined);
    };
    const syncModels = () => {
        void props.context.data.location.model.sync(location()).catch(() => undefined);
    };

    onMount(() => {
        syncMessages();
        syncModels();
    });

    createEffect(
        on(
            () => props.sessionID,
            () => {
                syncMessages();
                syncModels();
            },
            { defer: true },
        ),
    );

    createEffect(
        on(
            () => location()?.directory,
            () => syncModels(),
            { defer: true },
        ),
    );

    const unsubscribe = [
        props.context.data.on('session.step.ended', (event) => {
            if (event.data.sessionID === props.sessionID) syncMessages();
        }),
        props.context.data.on('session.compaction.ended', (event) => {
            if (event.data.sessionID === props.sessionID) syncMessages();
        }),
        props.context.data.on('session.revert.committed', (event) => {
            if (event.data.sessionID === props.sessionID) syncMessages();
        }),
        props.context.data.on('session.revert.cleared', (event) => {
            if (event.data.sessionID === props.sessionID) syncMessages();
        }),
        props.context.data.on('session.usage.updated', (event) => {
            if (event.data.sessionID === props.sessionID) syncMessages();
        }),
        props.context.data.on('session.execution.succeeded', (event) => {
            if (event.data.sessionID === props.sessionID) syncMessages();
        }),
    ];
    onCleanup(() => unsubscribe.forEach((off) => off()));

    const stats = createMemo<StatsSnapshot>(() => {
        props.tracker.revision();
        const current = session();
        const tokens = current?.tokens;
        const context = usage();
        return {
            input: tokens?.input ?? 0,
            output: tokens?.output ?? 0,
            reasoning: tokens?.reasoning ?? 0,
            cacheRead: tokens?.cache?.read ?? 0,
            cacheWrite: tokens?.cache?.write ?? 0,
            cost: current?.cost ?? 0,
            contextUsed: context?.used,
            contextLimit: context?.limit,
            tps: props.tracker.displayTps(props.sessionID),
            tpsAvg: props.tracker.averageTps(props.sessionID),
            ttftMs: props.tracker.currentTtftMs(props.sessionID),
            ttftAvgMs: props.tracker.averageTtftMs(props.sessionID),
            durationMs: current ? Date.now() - current.time.created : undefined,
        };
    });

    const segments = createMemo(() => normalizeSegments(props.settings.segments) ?? [...props.baseline.segments]);
    const fullLine = createMemo(() => buildLine(stats(), segments()));
    const fallbackWidth = createMemo(() => Math.max(8, terminalWidth() - 12));
    const minimumWidth = createMemo(() => (props.fit ? 5 : 0));
    const availableWidth = createMemo(() =>
        Math.max(minimumWidth(), Math.min(measuredWidth() ?? fallbackWidth(), fallbackWidth())),
    );
    const visibleLine = createMemo(() => (props.fit ? fitLine(fullLine(), availableWidth()) : fullLine()));
    const visibleWidth = createMemo(() => lineWidth(visibleLine()));

    createEffect(
        on(
            () => terminalWidth(),
            () => setMeasuredWidth(undefined),
            { defer: true },
        ),
    );

    return (
        <Show when={visibleLine().length > 0}>
            <box
                flexDirection="row"
                flexShrink={props.fit ? 1 : 0}
                minWidth={minimumWidth()}
                onSizeChange={function (this: BoxRenderable) {
                    if (!props.fit) return;
                    const width = this.width;
                    if (!Number.isFinite(width) || width < 8) return;
                    if (width < visibleWidth() - 0.5) setMeasuredWidth(width);
                }}
            >
                <text wrapMode="none" truncate>
                    <For each={visibleLine()}>
                        {(segment, segmentIndex) => (
                            <>
                                {segmentIndex() > 0 ? ' ' : ''}
                                <For each={segment.parts}>
                                    {(part) => <span style={{ fg: toneColor(theme, part.tone) }}>{part.text}</span>}
                                </For>
                            </>
                        )}
                    </For>
                </text>
            </box>
        </Show>
    );
}

function toneColor(theme: Context['theme'], tone: Tone): RGBA {
    switch (tone) {
        case 'muted':
            return theme.text.muted;
        case 'warning':
            return theme.text.feedback.warning.base;
        case 'error':
            return theme.text.feedback.error.base;
        case 'success':
            return theme.text.feedback.success.base;
        default:
            return theme.text.base;
    }
}
