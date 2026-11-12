import { describe, expect, test } from "bun:test"
import {
  DEFAULT_SEGMENTS,
  SEGMENTS,
  SEGMENT_IDS,
  buildLine,
  fitLine,
  isSegmentId,
  lineText,
  lineWidth,
  normalizeSegments,
} from "./segments"
import type { StatsSnapshot } from "./stats"

const sample: StatsSnapshot = {
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

const empty: StatsSnapshot = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
}

describe("segment catalog", () => {
  test("lists every segment in catalog order", () => {
    expect(SEGMENT_IDS).toEqual([
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
      "cacheHit",
      "cost",
      "context",
      "tps",
      "tpsAvg",
      "ttft",
      "ttftAvg",
      "total",
      "duration",
    ])
    expect(SEGMENTS.map((segment) => segment.id)).toEqual([...SEGMENT_IDS])
  })

  test("uses the default visible segments", () => {
    expect(DEFAULT_SEGMENTS).toEqual([
      "input",
      "output",
      "cacheRead",
      "cacheHit",
      "cost",
      "context",
      "tps",
      "ttft",
    ])
  })

  test("defines a label and description for every segment", () => {
    expect(SEGMENTS.map((segment) => segment.label)).toEqual([
      "Input",
      "Output",
      "Cache read",
      "Cache write",
      "Cache hit",
      "Cost",
      "Context",
      "Live TPS",
      "Average TPS",
      "TTFT",
      "Average TTFT",
      "Total tokens",
      "Elapsed",
    ])
    for (const segment of SEGMENTS) {
      expect(segment.label.length).toBeGreaterThan(0)
      expect(segment.description.length).toBeGreaterThan(0)
    }
  })
})

describe("isSegmentId", () => {
  test("accepts known ids only", () => {
    expect(isSegmentId("input")).toBe(true)
    expect(isSegmentId("duration")).toBe(true)
    expect(isSegmentId("bogus")).toBe(false)
    expect(isSegmentId(undefined)).toBe(false)
    expect(isSegmentId(null)).toBe(false)
    expect(isSegmentId(1)).toBe(false)
    expect(isSegmentId({})).toBe(false)
  })
})

describe("normalizeSegments", () => {
  test("rejects values that are not arrays", () => {
    expect(normalizeSegments(undefined)).toBeUndefined()
    expect(normalizeSegments(null)).toBeUndefined()
    expect(normalizeSegments("input")).toBeUndefined()
    expect(normalizeSegments({ 0: "input", length: 1 })).toBeUndefined()
  })

  test("preserves an explicitly empty list", () => {
    expect(normalizeSegments([])).toEqual([])
  })

  test("filters invalid entries and removes duplicates in order", () => {
    expect(normalizeSegments(["output", "input", "output"])).toEqual([
      "output",
      "input",
    ])
    expect(normalizeSegments(["input", 42, "bogus", "cost"])).toEqual([
      "input",
      "cost",
    ])
  })

  test("returns undefined when every entry is invalid", () => {
    expect(normalizeSegments(["bogus"])).toBeUndefined()
    expect(normalizeSegments(["bogus", 42, null])).toBeUndefined()
  })
})

describe("buildLine", () => {
  test("renders the default segments", () => {
    expect(lineText(buildLine(sample, DEFAULT_SEGMENTS))).toBe(
      "↑343k ↓225k R37M CH99.1% $0.297 33.1%/1.0M 120TPS 12sTTFT",
    )
  })

  test("renders every segment", () => {
    const full: StatsSnapshot = {
      input: 1_000,
      output: 2_000,
      reasoning: 500,
      cacheRead: 9_000,
      cacheWrite: 300,
      cost: 1.5,
      contextUsed: 500_000,
      contextLimit: 1_000_000,
      tps: 50,
      tpsAvg: 20,
      ttftMs: 800,
      ttftAvgMs: 1_500,
      durationMs: 65_000,
    }
    const line = buildLine(full, SEGMENT_IDS)
    expect(line.map((segment) => segment.id)).toEqual([...SEGMENT_IDS])
    expect(lineText(line)).toBe(
      "↑1k ↓2.5k R9k W300 CH90.0% $1.50 50.0%/1.0M 50.0TPS AVG20.0TPS 800msTTFT AVG1.5sTTFT Σ12.8k EL1m5s",
    )
  })

  test("skips optional segments without usable values", () => {
    const line = buildLine(empty, [
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
      "cacheHit",
      "cost",
      "context",
      "tps",
      "tpsAvg",
      "ttft",
      "ttftAvg",
      "total",
      "duration",
    ])
    expect(lineText(line)).toBe("↑0 ↓0 R0 W0 $0.000 Σ0")
  })

  test("returns an empty line without segments", () => {
    expect(buildLine(sample, [])).toEqual([])
  })

  test("applies cache hit tones", () => {
    const success = buildLine(
      { ...empty, input: 100, cacheRead: 900 },
      ["cacheHit"],
    )
    expect(success[0]?.parts[1]).toEqual({ text: "90.0%", tone: "success" })

    const neutral = buildLine(
      { ...empty, input: 100, cacheRead: 100 },
      ["cacheHit"],
    )
    expect(neutral[0]?.parts[1]).toEqual({ text: "50.0%", tone: "default" })

    const warning = buildLine(
      { ...empty, input: 51, cacheRead: 49 },
      ["cacheHit"],
    )
    expect(warning[0]?.parts[1]).toEqual({ text: "49.0%", tone: "warning" })
  })

  test("applies context tones and skips an invalid limit", () => {
    const warning = buildLine(
      { ...empty, contextUsed: 75, contextLimit: 100 },
      ["context"],
    )
    expect(warning[0]?.parts[0]).toEqual({ text: "75.0%", tone: "warning" })

    const error = buildLine(
      { ...empty, contextUsed: 95, contextLimit: 100 },
      ["context"],
    )
    expect(error[0]?.parts[0]).toEqual({ text: "95.0%", tone: "error" })

    expect(
      buildLine({ ...empty, contextUsed: 75, contextLimit: 0 }, ["context"]),
    ).toEqual([])
    expect(
      buildLine({ ...empty, contextUsed: 75, contextLimit: Number.NaN }, [
        "context",
      ]),
    ).toEqual([])
  })
})

describe("lineWidth", () => {
  test("is zero for an empty line", () => {
    expect(lineWidth([])).toBe(0)
  })

  test("counts part text plus one space between segments", () => {
    const line = buildLine(sample, ["input", "output"])
    expect(lineText(line)).toBe("↑343k ↓225k")
    expect(lineWidth(line)).toBe(11)
    expect(lineWidth(line)).toBe(lineText(line).length)
  })
})

describe("lineText", () => {
  test("returns an empty string for an empty line", () => {
    expect(lineText([])).toBe("")
  })

  test("joins segments with spaces and concatenates parts", () => {
    expect(lineText(buildLine(sample, ["cost", "tps"]))).toBe("$0.297 120TPS")
  })
})

describe("fitLine", () => {
  test("returns an empty line for non-positive widths", () => {
    const line = buildLine(sample, DEFAULT_SEGMENTS)
    expect(fitLine(line, 0)).toEqual([])
    expect(fitLine(line, -1)).toEqual([])
    expect(fitLine([], 100)).toEqual([])
  })

  test("keeps the full line when it fits", () => {
    const line = buildLine(sample, DEFAULT_SEGMENTS)
    expect(lineWidth(line)).toBe(57)
    expect(fitLine(line, 57)).toEqual(line)
    expect(fitLine(line, 1_000)).toEqual(line)
  })

  test("drops trailing segments until the line fits", () => {
    const line = buildLine(sample, DEFAULT_SEGMENTS)
    expect(fitLine(line, 56).map((segment) => segment.id)).toEqual([
      "input",
      "output",
      "cacheRead",
      "cacheHit",
      "cost",
      "context",
      "tps",
    ])
    expect(fitLine(line, 44).map((segment) => segment.id)).toEqual([
      "input",
      "output",
      "cacheRead",
      "cacheHit",
      "cost",
      "context",
    ])
    expect(fitLine(line, 42).map((segment) => segment.id)).toEqual([
      "input",
      "output",
      "cacheRead",
      "cacheHit",
      "cost",
      "context",
    ])
    expect(fitLine(line, 41).map((segment) => segment.id)).toEqual([
      "input",
      "output",
      "cacheRead",
      "cacheHit",
      "cost",
    ])
    expect(fitLine(line, 10).map((segment) => segment.id)).toEqual(["input"])
    expect(fitLine(line, 4)).toEqual([])
  })

  test("does not mutate the input line", () => {
    const line = buildLine(sample, DEFAULT_SEGMENTS)
    const original = [...line]
    fitLine(line, 10)
    expect(line).toEqual(original)
  })
})
