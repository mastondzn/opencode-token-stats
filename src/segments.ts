import type { Tone } from "./format"
import {
  cacheHitPercent,
  formatContextLimit,
  formatCost,
  formatDuration,
  formatPercent,
  formatTps,
  formatTtft,
  formatTokenCount,
  toneForCacheHit,
  toneForContext,
} from "./format"
import type { StatsSnapshot } from "./stats"

export type SegmentId =
  | "input"
  | "output"
  | "cacheRead"
  | "cacheWrite"
  | "cacheHit"
  | "cost"
  | "context"
  | "tps"
  | "tpsAvg"
  | "ttft"
  | "ttftAvg"
  | "total"
  | "duration"

export interface SegmentDefinition {
  readonly id: SegmentId
  readonly label: string
  readonly description: string
}

export const SEGMENTS: readonly SegmentDefinition[] = [
  {
    id: "input",
    label: "Input",
    description: "Prompt tokens sent to the model",
  },
  {
    id: "output",
    label: "Output",
    description: "Output tokens including reasoning",
  },
  {
    id: "cacheRead",
    label: "Cache read",
    description: "Prompt tokens served from cache",
  },
  {
    id: "cacheWrite",
    label: "Cache write",
    description: "Prompt tokens written to cache",
  },
  {
    id: "cacheHit",
    label: "Cache hit",
    description: "Share of prompt tokens read from cache",
  },
  {
    id: "cost",
    label: "Cost",
    description: "Session cost in US dollars",
  },
  {
    id: "context",
    label: "Context",
    description: "Context window usage",
  },
  {
    id: "tps",
    label: "Live TPS",
    description: "Current output tokens per second",
  },
  {
    id: "tpsAvg",
    label: "Average TPS",
    description: "Average output tokens per second",
  },
  {
    id: "ttft",
    label: "TTFT",
    description: "Time to first token",
  },
  {
    id: "ttftAvg",
    label: "Average TTFT",
    description: "Average time to first token",
  },
  {
    id: "total",
    label: "Total tokens",
    description: "All session tokens including cache",
  },
  {
    id: "duration",
    label: "Elapsed",
    description: "Time since the session started",
  },
]

export const SEGMENT_IDS: readonly SegmentId[] = SEGMENTS.map((segment) => segment.id)

export const DEFAULT_SEGMENTS: readonly SegmentId[] = [
  "input",
  "output",
  "cacheRead",
  "cacheHit",
  "cost",
  "context",
  "tps",
  "ttft",
]

export interface SegmentPart {
  readonly text: string
  readonly tone: Tone
}

export interface SegmentLine {
  readonly id: SegmentId
  readonly parts: readonly SegmentPart[]
}

const SEGMENT_ID_SET = new Set<string>(SEGMENT_IDS)

export function isSegmentId(value: unknown): value is SegmentId {
  return typeof value === "string" && SEGMENT_ID_SET.has(value)
}

export function normalizeSegments(value: unknown): SegmentId[] | undefined {
  if (!Array.isArray(value)) return undefined

  const segments: SegmentId[] = []
  for (const item of value) {
    if (!isSegmentId(item) || segments.includes(item)) continue
    segments.push(item)
  }

  if (value.length > 0 && segments.length === 0) return undefined
  return segments
}

export function buildLine(
  stats: StatsSnapshot,
  segments: readonly SegmentId[],
): SegmentLine[] {
  const line: SegmentLine[] = []

  for (const id of segments) {
    switch (id) {
      case "input":
        line.push({
          id,
          parts: [
            { text: "↑", tone: "muted" },
            { text: formatTokenCount(stats.input), tone: "default" },
          ],
        })
        break
      case "output":
        line.push({
          id,
          parts: [
            { text: "↓", tone: "muted" },
            {
              text: formatTokenCount(stats.output + stats.reasoning),
              tone: "default",
            },
          ],
        })
        break
      case "cacheRead":
        line.push({
          id,
          parts: [
            { text: "R", tone: "muted" },
            { text: formatTokenCount(stats.cacheRead), tone: "default" },
          ],
        })
        break
      case "cacheWrite":
        line.push({
          id,
          parts: [
            { text: "W", tone: "muted" },
            { text: formatTokenCount(stats.cacheWrite), tone: "default" },
          ],
        })
        break
      case "cacheHit": {
        const percent = cacheHitPercent(stats.cacheRead, stats.input)
        if (percent === undefined) break
        line.push({
          id,
          parts: [
            { text: "CH", tone: "muted" },
            { text: formatPercent(percent), tone: toneForCacheHit(percent) },
          ],
        })
        break
      }
      case "cost":
        line.push({
          id,
          parts: [{ text: formatCost(stats.cost), tone: "default" }],
        })
        break
      case "context": {
        const used = stats.contextUsed
        const limit = stats.contextLimit
        if (
          used === undefined ||
          limit === undefined ||
          !Number.isFinite(used) ||
          !Number.isFinite(limit) ||
          limit <= 0
        ) {
          break
        }
        const percent = (used / limit) * 100
        line.push({
          id,
          parts: [
            { text: formatPercent(percent), tone: toneForContext(percent) },
            { text: `/${formatContextLimit(limit)}`, tone: "muted" },
          ],
        })
        break
      }
      case "tps": {
        const value = formatTps(stats.tps)
        if (value === undefined) break
        line.push({
          id,
          parts: [
            { text: value, tone: "default" },
            { text: "TPS", tone: "muted" },
          ],
        })
        break
      }
      case "tpsAvg": {
        const value = formatTps(stats.tpsAvg)
        if (value === undefined) break
        line.push({
          id,
          parts: [
            { text: "AVG", tone: "muted" },
            { text: value, tone: "default" },
            { text: "TPS", tone: "muted" },
          ],
        })
        break
      }
      case "ttft": {
        const value = formatTtft(stats.ttftMs)
        if (value === undefined) break
        line.push({
          id,
          parts: [
            { text: value, tone: "default" },
            { text: "TTFT", tone: "muted" },
          ],
        })
        break
      }
      case "ttftAvg": {
        const value = formatTtft(stats.ttftAvgMs)
        if (value === undefined) break
        line.push({
          id,
          parts: [
            { text: "AVG", tone: "muted" },
            { text: value, tone: "default" },
            { text: "TTFT", tone: "muted" },
          ],
        })
        break
      }
      case "total": {
        const total =
          stats.input +
          stats.output +
          stats.reasoning +
          stats.cacheRead +
          stats.cacheWrite
        line.push({
          id,
          parts: [
            { text: "Σ", tone: "muted" },
            { text: formatTokenCount(total), tone: "default" },
          ],
        })
        break
      }
      case "duration": {
        const value = formatDuration(stats.durationMs)
        if (value === undefined) break
        line.push({
          id,
          parts: [
            { text: "EL", tone: "muted" },
            { text: value, tone: "default" },
          ],
        })
        break
      }
    }
  }

  return line
}

export function lineWidth(line: readonly SegmentLine[]): number {
  if (line.length === 0) return 0

  let width = line.length - 1
  for (const segment of line) {
    for (const part of segment.parts) width += part.text.length
  }
  return width
}

export function lineText(line: readonly SegmentLine[]): string {
  return line
    .map((segment) => segment.parts.map((part) => part.text).join(""))
    .join(" ")
}

export function fitLine(
  line: readonly SegmentLine[],
  maxWidth: number,
): SegmentLine[] {
  if (maxWidth <= 0) return []

  const result = [...line]
  while (result.length > 0 && lineWidth(result) > maxWidth) result.pop()
  return result
}
