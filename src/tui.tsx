import { Plugin } from "@opencode/plugin/tui"
import type { BoxRenderable, RGBA } from "@opentui/core"
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type Accessor,
} from "solid-js"
import type { Store } from "solid-js/store"
import type { Tone } from "./format"
import {
  DEFAULT_SEGMENTS,
  SEGMENTS,
  SEGMENT_IDS,
  buildLine,
  fitLine,
  lineWidth,
  normalizeSegments,
  type SegmentId,
} from "./segments"
import {
  PLACEMENTS,
  normalizePlacement,
  nextPlacement,
  type Placement,
} from "./placement"
import { contextUsage, type StatsSnapshot } from "./stats"
import { createTracker, type Tracker } from "./tracker"

type Context = Plugin.Context

type Settings = { segments: SegmentId[]; placement: Placement }
type Baseline = { segments: SegmentId[]; placement: Placement }
type SettingsStore = Store<Settings>
type UpdateSettings = (mutation: (draft: Settings) => void) => Promise<void>

const PLUGIN_ID = "mastondzn.token-stats"
const STORE_KEY = "settings"
const COMMAND_ID = "mastondzn.token-stats.configure"

export default Plugin.define({
  id: PLUGIN_ID,
  setup(context) {
    const baseline: Baseline = {
      segments: normalizeSegments(context.options.segments) ?? [...DEFAULT_SEGMENTS],
      placement: normalizePlacement(context.options.placement),
    }
    const [settings, updateSettings] = context.storage.store<Settings>(STORE_KEY, {
      initial: { segments: [...baseline.segments], placement: baseline.placement },
    })
    const tracker = createTracker(context)

    let layerRegistered = false
    const unregisterApp = context.ui.slot({
      append: "app",
      render: () => {
        if (layerRegistered) return null
        layerRegistered = true
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: COMMAND_ID,
              title: "Token stats: Configure",
              group: "Token stats",
              palette: true,
              slash: { name: "token-stats", aliases: ["tokens"] },
              run: () => {
                openConfigureDialog({ context, settings, updateSettings, baseline })
              },
            },
          ],
        }))
        return null
      },
    })

    const unregisterComposer = context.ui.slot({
      append: "session.composer.top",
      render: (input) => (
        <TokenStatsComposer
          context={context}
          sessionID={input.sessionID}
          settings={settings}
          baseline={baseline}
          tracker={tracker}
        />
      ),
    })

    const unregisterFooter = context.ui.slot({
      append: "prompt.footer.status",
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
    })

    return () => {
      unregisterApp()
      unregisterComposer()
      unregisterFooter()
      tracker.dispose()
    }
  },
})

function openConfigureDialog(props: {
  context: Context
  settings: SettingsStore
  updateSettings: UpdateSettings
  baseline: Baseline
}) {
  props.context.ui.dialog.set({ size: "large", centered: true })
  props.context.ui.dialog.show(() => <ConfigureDialog {...props} />)
}

function TokenStatsSlot(props: {
  context: Context
  sessionID: string | undefined
  mode: "normal" | "shell"
  settings: SettingsStore
  baseline: Baseline
  tracker: Tracker
}) {
  const placement = createMemo(() =>
    normalizePlacement(props.settings.placement ?? props.baseline.placement),
  )

  return (
    <Show when={placement() === "footer" || placement() === "footer-compact"}>
      <Show when={props.mode === "normal" ? props.sessionID : undefined}>
        {(sessionID: Accessor<string>) => (
          <TokenStatsLine
            context={props.context}
            sessionID={sessionID()}
            settings={props.settings}
            baseline={props.baseline}
            tracker={props.tracker}
            fit={placement() === "footer-compact"}
          />
        )}
      </Show>
    </Show>
  )
}

function TokenStatsComposer(props: {
  context: Context
  sessionID: string
  settings: SettingsStore
  baseline: Baseline
  tracker: Tracker
}) {
  const placement = createMemo(() =>
    normalizePlacement(props.settings.placement ?? props.baseline.placement),
  )

  return (
    <Show when={placement() === "composer"}>
      <TokenStatsLine
        context={props.context}
        sessionID={props.sessionID}
        settings={props.settings}
        baseline={props.baseline}
        tracker={props.tracker}
        fit
      />
    </Show>
  )
}

function TokenStatsLine(props: {
  context: Context
  sessionID: string
  settings: SettingsStore
  baseline: Baseline
  tracker: Tracker
  fit: boolean
}) {
  const [terminalWidth, setTerminalWidth] = createSignal(props.context.renderer.width)
  const [measuredWidth, setMeasuredWidth] = createSignal<number>()
  const theme = props.context.theme
  const onResize = (width: number) => setTerminalWidth(width)
  props.context.renderer.on("resize", onResize)
  onCleanup(() => props.context.renderer.off("resize", onResize))

  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const location = createMemo(
    () => session()?.location ?? props.context.location ?? props.context.data.location.default(),
  )
  const models = createMemo(() => props.context.data.location.model.list(location()) ?? [])
  const messages = createMemo(() => props.context.data.session.message.list(props.sessionID) ?? [])
  const usage = createMemo(() => contextUsage(messages(), models(), session()?.revert?.messageID))

  const syncMessages = () => {
    void props.context.data.session.message.sync(props.sessionID).catch(() => undefined)
  }
  const syncModels = () => {
    void props.context.data.location.model.sync(location()).catch(() => undefined)
  }

  onMount(() => {
    syncMessages()
    syncModels()
  })

  createEffect(
    on(
      () => props.sessionID,
      () => {
        syncMessages()
        syncModels()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => location()?.directory,
      () => syncModels(),
      { defer: true },
    ),
  )

  const unsubscribe = [
    props.context.data.on("session.step.ended", (event) => {
      if (event.data.sessionID === props.sessionID) syncMessages()
    }),
    props.context.data.on("session.compaction.ended", (event) => {
      if (event.data.sessionID === props.sessionID) syncMessages()
    }),
    props.context.data.on("session.revert.committed", (event) => {
      if (event.data.sessionID === props.sessionID) syncMessages()
    }),
    props.context.data.on("session.revert.cleared", (event) => {
      if (event.data.sessionID === props.sessionID) syncMessages()
    }),
    props.context.data.on("session.usage.updated", (event) => {
      if (event.data.sessionID === props.sessionID) syncMessages()
    }),
    props.context.data.on("session.execution.succeeded", (event) => {
      if (event.data.sessionID === props.sessionID) syncMessages()
    }),
  ]
  onCleanup(() => unsubscribe.forEach((off) => off()))

  const stats = createMemo<StatsSnapshot>(() => {
    props.tracker.revision()
    const current = session()
    const tokens = current?.tokens
    const context = usage()
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
    }
  })

  const segments = createMemo(
    () => normalizeSegments(props.settings.segments) ?? [...props.baseline.segments],
  )
  const fullLine = createMemo(() => buildLine(stats(), segments()))
  const fallbackWidth = createMemo(() => Math.max(8, terminalWidth() - 12))
  const minimumWidth = createMemo(() => (props.fit ? 5 : 0))
  const availableWidth = createMemo(() =>
    Math.max(minimumWidth(), Math.min(measuredWidth() ?? fallbackWidth(), fallbackWidth())),
  )
  const visibleLine = createMemo(() =>
    props.fit ? fitLine(fullLine(), availableWidth()) : fullLine(),
  )
  const visibleWidth = createMemo(() => lineWidth(visibleLine()))

  createEffect(
    on(
      () => terminalWidth(),
      () => setMeasuredWidth(undefined),
      { defer: true },
    ),
  )

  return (
    <Show when={visibleLine().length > 0}>
      <box
        flexDirection="row"
        flexShrink={props.fit ? 1 : 0}
        minWidth={minimumWidth()}
        onSizeChange={function (this: BoxRenderable) {
          if (!props.fit) return
          const width = this.width
          if (!Number.isFinite(width) || width < 8) return
          if (width < visibleWidth() - 0.5) setMeasuredWidth(width)
        }}
      >
        <text wrapMode="none" truncate>
          <For each={visibleLine()}>
            {(segment, segmentIndex) => (
              <>
                {segmentIndex() > 0 ? " " : ""}
                <For each={segment.parts}>
                  {(part) => <span style={{ fg: toneColor(theme, part.tone) }}>{part.text}</span>}
                </For>
              </>
            )}
          </For>
        </text>
      </box>
    </Show>
  )
}

function toneColor(theme: Context["theme"], tone: Tone): RGBA {
  switch (tone) {
    case "muted":
      return theme.text.muted
    case "warning":
      return theme.text.feedback.warning.base
    case "error":
      return theme.text.feedback.error.base
    case "success":
      return theme.text.feedback.success.base
    default:
      return theme.text.base
  }
}

function ConfigureDialog(props: {
  context: Context
  settings: SettingsStore
  updateSettings: UpdateSettings
  baseline: Baseline
}) {
  const theme = props.context.theme
  const [draft, setDraft] = createSignal<SegmentId[]>(
    normalizeSegments(props.settings.segments) ?? [...props.baseline.segments],
  )
  const [placement, setPlacement] = createSignal<Placement>(
    normalizePlacement(props.settings.placement ?? props.baseline.placement),
  )
  const [cursor, setCursor] = createSignal(0)

  const move = (delta: number) => {
    setCursor((current) => (current + delta + SEGMENTS.length) % SEGMENTS.length)
  }

  const toggle = () => {
    const segment = SEGMENTS[cursor()]
    if (!segment) return
    setDraft((current) => {
      if (current.includes(segment.id)) return current.filter((id) => id !== segment.id)
      const catalogIndex = SEGMENT_IDS.indexOf(segment.id)
      const next = [...current]
      const at = next.findIndex((id) => SEGMENT_IDS.indexOf(id) > catalogIndex)
      if (at === -1) next.push(segment.id)
      else next.splice(at, 0, segment.id)
      return next
    })
  }

  const reset = () => {
    setDraft([...props.baseline.segments])
    setPlacement(props.baseline.placement)
  }

  const toggleAll = () => {
    setDraft((current) => (current.length === SEGMENT_IDS.length ? [] : [...SEGMENT_IDS]))
  }

  const cyclePlacement = () => setPlacement((current) => nextPlacement(current))

  const placementLabel = createMemo(
    () => PLACEMENTS.find((item) => item.id === placement()) ?? PLACEMENTS[0],
  )

  const save = async () => {
    try {
      await props.updateSettings((settings) => {
        settings.segments = draft()
        settings.placement = placement()
      })
    } catch (error) {
      props.context.ui.toast.show({
        title: "Token stats",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
      return
    }
    props.context.ui.dialog.clear()
  }

  props.context.keymap.layer(() => ({
    mode: "modal",
    priority: 10,
    commands: [
      {
        bind: "up",
        title: "Previous segment",
        group: "Token stats",
        run: () => move(-1),
      },
      {
        bind: "down",
        title: "Next segment",
        group: "Token stats",
        run: () => move(1),
      },
      {
        bind: "space",
        title: "Toggle segment",
        group: "Token stats",
        run: toggle,
      },
      {
        bind: "return",
        title: "Save token stats segments",
        group: "Token stats",
        run: () => void save(),
      },
      {
        bind: "r",
        title: "Reset token stats segments",
        group: "Token stats",
        run: reset,
      },
      {
        bind: "a",
        title: "Toggle all token stats segments",
        group: "Token stats",
        run: toggleAll,
      },
      {
        bind: "p",
        title: "Cycle token stats placement",
        group: "Token stats",
        run: cyclePlacement,
      },
    ],
  }))

  const half = Math.ceil(SEGMENTS.length / 2)
  const rows = createMemo(() =>
    Array.from({ length: half }, (_, index) => ({
      left: SEGMENTS[index],
      right: SEGMENTS[index + half],
    })),
  )
  const activeSegment = createMemo(() => SEGMENTS[cursor()])

  const cell = (segment: (typeof SEGMENTS)[number] | undefined, index: number) => {
    if (!segment) return <box flexGrow={1} />
    const active = () => cursor() === index
    const enabled = () => draft().includes(segment.id)
    return (
      <box flexGrow={1} flexDirection="row">
        <text fg={active() ? theme.text.base : theme.text.faint} wrapMode="none">
          {active() ? "› " : "  "}
        </text>
        <text
          fg={enabled() ? theme.text.feedback.success.base : theme.text.muted}
          wrapMode="none"
        >
          {enabled() ? "[x] " : "[ ] "}
        </text>
        <text fg={active() ? theme.text.base : theme.text.muted} wrapMode="none">
          {segment.label}
        </text>
      </box>
    )
  }

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text.base}>Token stats</text>
      <text fg={theme.text.muted} wrapMode="none" truncate>
        space toggle · ↑↓ move · p place · enter save · esc cancel · r reset · a all
      </text>
      <text fg={theme.text.muted} wrapMode="none" truncate>
        {`Placement: ${placementLabel()?.label ?? ""} (p cycles) · ${placementLabel()?.description ?? ""}`}
      </text>
      <box flexDirection="column">
        <For each={rows()}>
          {(row, index) => (
            <box flexDirection="row" gap={1}>
              {cell(row.left, index())}
              {cell(row.right, index() + half)}
            </box>
          )}
        </For>
      </box>
      <text fg={theme.text.faint} wrapMode="none" truncate>
        {activeSegment()
          ? `${activeSegment()!.label}: ${activeSegment()!.description}`
          : ""}
      </text>
    </box>
  )
}
