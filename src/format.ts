export type Tone = "default" | "muted" | "warning" | "error" | "success"

const TOKEN_UNITS = [
  { size: 1_000_000_000_000, suffix: "T" },
  { size: 1_000_000_000, suffix: "B" },
  { size: 1_000_000, suffix: "M" },
  { size: 1_000, suffix: "k" },
] as const

export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0"
  if (value < 1_000) return String(Math.round(value))

  let unitIndex = TOKEN_UNITS.findIndex((unit) => value >= unit.size)
  let unit = TOKEN_UNITS[unitIndex]
  if (!unit) return "0"

  let scaled = value / unit.size
  let decimals = scaled >= 100 || Number.isInteger(scaled) ? 0 : 1
  let rounded = Number(scaled.toFixed(decimals))

  if (rounded >= 1_000 && unitIndex > 0) {
    unitIndex -= 1
    unit = TOKEN_UNITS[unitIndex]
    if (!unit) return "0"
    scaled = value / unit.size
    decimals = 0
    rounded = Number(scaled.toFixed(decimals))
  }

  return `${rounded.toFixed(decimals)}${unit.suffix}`
}

export function formatContextLimit(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "?"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) {
    if (value % 1_000 === 0) return `${value / 1_000}k`
    return `${(value / 1_000).toFixed(1)}k`
  }
  return String(Math.round(value))
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0.0%"
  if (Math.abs(value - 100) <= 0.05) return "100%"
  return `${value.toFixed(1)}%`
}

export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "$0.000"
  if (value === 0) return "$0.000"
  if (value < 0.001) return "<$0.001"
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

export function formatTps(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  if (value >= 100) return String(Math.round(value))
  if (value >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

export function formatTtft(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 10_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${Math.round(ms / 1_000)}s`
}

export function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined

  const totalSeconds = Math.floor(ms / 1_000)
  if (totalSeconds < 60) return `${totalSeconds}s`

  if (totalSeconds < 3_600) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}m${seconds > 0 ? `${seconds}s` : ""}`
  }

  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  return `${hours}h${minutes > 0 ? `${minutes}m` : ""}`
}

export function cacheHitPercent(read: number, input: number): number | undefined {
  const denominator = read + input
  if (!Number.isFinite(denominator) || denominator <= 0) return undefined
  return (read / denominator) * 100
}

export function formatCacheHit(read: number, input: number): string | undefined {
  const percent = cacheHitPercent(read, input)
  return percent === undefined ? undefined : formatPercent(percent)
}

export function formatContext(
  used: number | undefined,
  limit: number | undefined,
): string | undefined {
  if (
    used === undefined ||
    limit === undefined ||
    !Number.isFinite(used) ||
    !Number.isFinite(limit) ||
    limit <= 0
  ) {
    return undefined
  }
  return `${formatPercent((used / limit) * 100)}/${formatContextLimit(limit)}`
}

export function toneForCacheHit(percent: number | undefined): Tone {
  if (percent === undefined) return "default"
  if (percent >= 90) return "success"
  if (percent < 50) return "warning"
  return "default"
}

export function toneForContext(percent: number | undefined): Tone {
  if (percent === undefined) return "default"
  if (percent >= 90) return "error"
  if (percent >= 70) return "warning"
  return "default"
}
