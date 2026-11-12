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
  lineText,
  lineWidth,
  normalizeSegments,
  type SegmentId,
} from "./segments"
import { contextUsage, type StatsSnapshot } from "./stats"
import { createTracker, type Tracker } from "./tracker"

type Context = Plugin.Context

type Settings = { segments: SegmentId[] }
type SettingsStore = Store<Settings>
type UpdateSettings = (mutation: (draft: Settings) => void) => Promise<void>

const PLUGIN_ID = "mastondzn.token-stats"
const STORE_KEY = "settings"
const COMMAND_ID = "mastondzn.token-stats.configure"

const SAMPLE_STATS: StatsSnapshot = {
  input: 343_000,
  output: 188_000,
  reasoning: 37_000,
  cacheRead: 37_000_000,
  cacheWrite: 0,
  cost: 0.297,
  contextUsed: 331_000,
  contextLimit: 1_000_000,
  tps: 120,
  ttftMs: 12_000,
}

export default Plugin.define({
  id: PLUGIN_ID,
  setup(context) {
    const baseline = normalizeSegments(context.options.segments) ?? [...DEFAULT_SEGMENTS]
    const [settings, updateSettings] = context.storage.store<Settings>(STORE_KEY, {
      initial: { segments: [...baseline] },
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
      unregisterFooter()
      tracker.dispose()
    }
  },
})

function openConfigureDialog(props: {
  context: Context
  settings: SettingsStore
  updateSettings: UpdateSettings
  baseline: readonly SegmentId[]
}) {
  props.context.ui.dialog.set({ size: "large", centered: true })
  props.context.ui.dialog.show(() => <ConfigureDialog {...props} />)
}

function TokenStatsSlot(props: {
  context: Context
  sessionID: string | undefined
  mode: "normal" | "shell"
  settings: SettingsStore
  baseline: readonly SegmentId[]
  tracker: Tracker
}) {
  return (
    <Show when={props.sessionID && props.mode === "normal"}>
      {(sessionID: Accessor<string>) => (
        <TokenStatsLine
          context={props.context}
          sessionID={sessionID()}
          settings={props.settings}
          baseline={props.baseline}
          tracker={props.tracker}
        />
      )}
    </Show>
  )
}

function TokenStatsLine(props: {
  context: Context
  sessionID: string
  settings: SettingsStore
  baseline: readonly SegmentId[]
  tracker: Tracker
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

  const segments = createMemo(() => normalizeSegments(props.settings.segments) ?? [...props.baseline])
  const fullLine = createMemo(() => buildLine(stats(), segments()))
  const fallbackWidth = createMemo(() => Math.max(8, terminalWidth() - 12))
  const availableWidth = createMemo(() => Math.min(measuredWidth() ?? fallbackWidth(), fallbackWidth()))
  const visibleLine = createMemo(() => fitLine(fullLine(), availableWidth()))
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
        flexShrink={1}
        minWidth={0}
        onSizeChange={function (this: BoxRenderable) {
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
  baseline: readonly SegmentId[]
}) {
  const theme = props.context.theme
  const [draft, setDraft] = createSignal<SegmentId[]>(
    normalizeSegments(props.settings.segments) ?? [...props.baseline],
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

  const reset = () => setDraft([...props.baseline])

  const toggleAll = () => {
    setDraft((current) => (current.length === SEGMENT_IDS.length ? [] : [...SEGMENT_IDS]))
  }

  const save = async () => {
    try {
      await props.updateSettings((settings) => {
        settings.segments = draft()
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
    ],
  }))

  const preview = createMemo(() => {
    const line = draft()
    return line.length === 0 ? "(no segments)" : lineText(buildLine(SAMPLE_STATS, line))
  })

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text.base}>Token stats</text>
      <text fg={theme.text.muted}>
        space toggle · up/down move · enter save · esc cancel · r reset · a all
      </text>
      <box flexDirection="column">
        <For each={SEGMENTS}>
          {(segment, index) => {
            const active = () => cursor() === index()
            const enabled = () => draft().includes(segment.id)
            return (
              <box flexDirection="row" gap={0}>
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
                <text fg={theme.text.faint} wrapMode="none" truncate flexShrink={1}>
                  {`  ${segment.description}`}
                </text>
              </box>
            )
          }}
        </For>
      </box>
      <text fg={theme.text.muted}>Preview</text>
      <text fg={theme.text.base} wrapMode="none" truncate>
        {preview()}
      </text>
    </box>
  )
}
