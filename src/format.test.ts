import { describe, expect, test } from "bun:test"
import {
  cacheHitPercent,
  formatCacheHit,
  formatContext,
  formatContextLimit,
  formatCost,
  formatDuration,
  formatPercent,
  formatTokenCount,
  formatTps,
  formatTtft,
  toneForCacheHit,
  toneForContext,
} from "./format"

describe("formatTokenCount", () => {
  test("returns zero for missing, non-finite, and non-positive values", () => {
    expect(formatTokenCount(0)).toBe("0")
    expect(formatTokenCount(-1)).toBe("0")
    expect(formatTokenCount(Number.NaN)).toBe("0")
    expect(formatTokenCount(Number.POSITIVE_INFINITY)).toBe("0")
    expect(formatTokenCount(Number.NEGATIVE_INFINITY)).toBe("0")
  })

  test("formats values below one thousand as integers", () => {
    expect(formatTokenCount(1)).toBe("1")
    expect(formatTokenCount(999)).toBe("999")
    expect(formatTokenCount(999.4)).toBe("999")
  })

  test("uses the largest available unit", () => {
    expect(formatTokenCount(1_000)).toBe("1k")
    expect(formatTokenCount(343_000)).toBe("343k")
    expect(formatTokenCount(225_000)).toBe("225k")
    expect(formatTokenCount(1_000_000)).toBe("1M")
    expect(formatTokenCount(37_000_000)).toBe("37M")
    expect(formatTokenCount(1_000_000_000)).toBe("1B")
    expect(formatTokenCount(1_000_000_000_000)).toBe("1T")
  })

  test("chooses decimals from the scaled value", () => {
    expect(formatTokenCount(1_234)).toBe("1.2k")
    expect(formatTokenCount(12_345)).toBe("12.3k")
    expect(formatTokenCount(33_100)).toBe("33.1k")
    expect(formatTokenCount(123_456)).toBe("123k")
    expect(formatTokenCount(1_234_567)).toBe("1.2M")
    expect(formatTokenCount(1_500_000)).toBe("1.5M")
    expect(formatTokenCount(12_345_678)).toBe("12.3M")
    expect(formatTokenCount(123_456_789)).toBe("123M")
  })

  test("promotes when rounding reaches one thousand", () => {
    expect(formatTokenCount(999_999)).toBe("1M")
    expect(formatTokenCount(999_999_999)).toBe("1B")
    expect(formatTokenCount(999_999_999_999)).toBe("1T")
  })
})

describe("formatContextLimit", () => {
  test("returns a question mark for missing or invalid limits", () => {
    expect(formatContextLimit(0)).toBe("?")
    expect(formatContextLimit(-1)).toBe("?")
    expect(formatContextLimit(Number.NaN)).toBe("?")
    expect(formatContextLimit(Number.POSITIVE_INFINITY)).toBe("?")
  })

  test("formats millions with one decimal", () => {
    expect(formatContextLimit(1_000_000)).toBe("1.0M")
    expect(formatContextLimit(2_000_000)).toBe("2.0M")
    expect(formatContextLimit(1_250_000)).toBe("1.3M")
  })

  test("formats thousands with an integer or one decimal", () => {
    expect(formatContextLimit(1_000)).toBe("1k")
    expect(formatContextLimit(200_000)).toBe("200k")
    expect(formatContextLimit(128_500)).toBe("128.5k")
  })

  test("formats sub-thousand limits as integers", () => {
    expect(formatContextLimit(999)).toBe("999")
    expect(formatContextLimit(128.6)).toBe("129")
  })
})

describe("formatPercent", () => {
  test("returns a zero percentage for non-finite values", () => {
    expect(formatPercent(Number.NaN)).toBe("0.0%")
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("0.0%")
  })

  test("collapses values near one hundred to an integer", () => {
    expect(formatPercent(100)).toBe("100%")
    expect(formatPercent(99.96)).toBe("100%")
    expect(formatPercent(100.04)).toBe("100%")
  })

  test("uses one decimal for other values", () => {
    expect(formatPercent(99.9)).toBe("99.9%")
    expect(formatPercent(33.1)).toBe("33.1%")
    expect(formatPercent(0)).toBe("0.0%")
    expect(formatPercent(101.2)).toBe("101.2%")
  })
})

describe("formatCost", () => {
  test("returns a zero cost for invalid and non-positive values", () => {
    expect(formatCost(0)).toBe("$0.000")
    expect(formatCost(-1)).toBe("$0.000")
    expect(formatCost(Number.NaN)).toBe("$0.000")
    expect(formatCost(Number.POSITIVE_INFINITY)).toBe("$0.000")
  })

  test("marks tiny positive costs", () => {
    expect(formatCost(0.000_5)).toBe("<$0.001")
    expect(formatCost(0.001)).toBe("$0.001")
  })

  test("uses three decimals below one dollar", () => {
    expect(formatCost(0.297)).toBe("$0.297")
    expect(formatCost(0.999)).toBe("$0.999")
  })

  test("uses two decimals at or above one dollar", () => {
    expect(formatCost(1)).toBe("$1.00")
    expect(formatCost(1.239)).toBe("$1.24")
    expect(formatCost(1.24)).toBe("$1.24")
  })
})

describe("formatTps", () => {
  test("returns undefined for missing, invalid, and non-positive values", () => {
    expect(formatTps(undefined)).toBeUndefined()
    expect(formatTps(0)).toBeUndefined()
    expect(formatTps(-1)).toBeUndefined()
    expect(formatTps(Number.NaN)).toBeUndefined()
    expect(formatTps(Number.POSITIVE_INFINITY)).toBeUndefined()
  })

  test("uses rounded integers at one hundred or more", () => {
    expect(formatTps(100)).toBe("100")
    expect(formatTps(120)).toBe("120")
    expect(formatTps(120.6)).toBe("121")
  })

  test("uses one decimal from ten to ninety-nine", () => {
    expect(formatTps(10)).toBe("10.0")
    expect(formatTps(33.14)).toBe("33.1")
    expect(formatTps(99.9)).toBe("99.9")
  })

  test("uses two decimals below ten", () => {
    expect(formatTps(0.1)).toBe("0.10")
    expect(formatTps(9.876)).toBe("9.88")
  })
})

describe("formatTtft", () => {
  test("returns undefined for missing, invalid, and negative values", () => {
    expect(formatTtft(undefined)).toBeUndefined()
    expect(formatTtft(-1)).toBeUndefined()
    expect(formatTtft(Number.NaN)).toBeUndefined()
    expect(formatTtft(Number.POSITIVE_INFINITY)).toBeUndefined()
  })

  test("uses milliseconds below one second", () => {
    expect(formatTtft(0)).toBe("0ms")
    expect(formatTtft(482)).toBe("482ms")
    expect(formatTtft(999.4)).toBe("999ms")
  })

  test("uses one decimal of seconds below ten seconds", () => {
    expect(formatTtft(1_000)).toBe("1.0s")
    expect(formatTtft(1_200)).toBe("1.2s")
    expect(formatTtft(9_999)).toBe("10.0s")
  })

  test("uses rounded whole seconds at ten seconds or more", () => {
    expect(formatTtft(10_000)).toBe("10s")
    expect(formatTtft(12_000)).toBe("12s")
  })
})

describe("formatDuration", () => {
  test("returns undefined for missing, invalid, and negative values", () => {
    expect(formatDuration(undefined)).toBeUndefined()
    expect(formatDuration(-1)).toBeUndefined()
    expect(formatDuration(Number.NaN)).toBeUndefined()
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBeUndefined()
  })

  test("uses whole seconds below one minute", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(999)).toBe("0s")
    expect(formatDuration(42_000)).toBe("42s")
    expect(formatDuration(59_999)).toBe("59s")
  })

  test("uses minutes with optional seconds below one hour", () => {
    expect(formatDuration(60_000)).toBe("1m")
    expect(formatDuration(65_000)).toBe("1m5s")
    expect(formatDuration(3_599_000)).toBe("59m59s")
  })

  test("uses hours with optional minutes at one hour or more", () => {
    expect(formatDuration(3_600_000)).toBe("1h")
    expect(formatDuration(3_720_000)).toBe("1h2m")
    expect(formatDuration(7_320_000)).toBe("2h2m")
    expect(formatDuration(86_400_000)).toBe("24h")
  })
})

describe("cacheHitPercent", () => {
  test("returns undefined when the denominator is not positive", () => {
    expect(cacheHitPercent(0, 0)).toBeUndefined()
    expect(cacheHitPercent(0, -1)).toBeUndefined()
    expect(cacheHitPercent(Number.NaN, 10)).toBeUndefined()
  })

  test("computes the cache read share", () => {
    expect(cacheHitPercent(100, 0)).toBe(100)
    expect(cacheHitPercent(0, 100)).toBe(0)
    expect(cacheHitPercent(1, 1)).toBe(50)
    expect(cacheHitPercent(37_000_000, 343_000)).toBeCloseTo(99.08, 2)
  })
})

describe("formatCacheHit", () => {
  test("passes through an undefined percentage", () => {
    expect(formatCacheHit(0, 0)).toBeUndefined()
  })

  test("formats the percentage", () => {
    expect(formatCacheHit(37_000_000, 343_000)).toBe("99.1%")
    expect(formatCacheHit(0, 100)).toBe("0.0%")
    expect(formatCacheHit(1, 0)).toBe("100%")
  })
})

describe("formatContext", () => {
  test("returns undefined when either value is missing or invalid", () => {
    expect(formatContext(undefined, 1_000)).toBeUndefined()
    expect(formatContext(100, undefined)).toBeUndefined()
    expect(formatContext(Number.NaN, 1_000)).toBeUndefined()
    expect(formatContext(100, Number.NaN)).toBeUndefined()
    expect(formatContext(100, 0)).toBeUndefined()
    expect(formatContext(100, -1)).toBeUndefined()
  })

  test("formats the used percentage and limit", () => {
    expect(formatContext(331_000, 1_000_000)).toBe("33.1%/1.0M")
    expect(formatContext(0, 1_000)).toBe("0.0%/1k")
  })
})

describe("toneForCacheHit", () => {
  test("maps the cache hit percentage to a tone", () => {
    expect(toneForCacheHit(undefined)).toBe("default")
    expect(toneForCacheHit(100)).toBe("success")
    expect(toneForCacheHit(90)).toBe("success")
    expect(toneForCacheHit(89.9)).toBe("default")
    expect(toneForCacheHit(50)).toBe("default")
    expect(toneForCacheHit(49.9)).toBe("warning")
  })
})

describe("toneForContext", () => {
  test("maps the context percentage to a tone", () => {
    expect(toneForContext(undefined)).toBe("default")
    expect(toneForContext(90)).toBe("error")
    expect(toneForContext(89.9)).toBe("warning")
    expect(toneForContext(70)).toBe("warning")
    expect(toneForContext(69.9)).toBe("default")
  })
})
