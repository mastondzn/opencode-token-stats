import { describe, expect, test } from "bun:test"
import {
  LIVE_STALE_MS,
  SINGLE_SAMPLE_MS,
  STREAM_WINDOW_MS,
  activeDuration,
  estimateTokens,
  liveRate,
  type Sample,
} from "./tracker"

const sample = (at: number, tokens = 1): Sample => ({ at, tokens })

describe("estimateTokens", () => {
  test("returns one token for an empty delta", () => {
    expect(estimateTokens("")).toBe(1)
    expect(estimateTokens("", 2)).toBe(1)
  })

  test("uses the default four bytes per token", () => {
    expect(estimateTokens("abcd")).toBe(1)
    expect(estimateTokens("abcde")).toBe(2)
    expect(estimateTokens("hello world")).toBe(3)
  })

  test("counts utf-8 bytes rather than characters", () => {
    expect(estimateTokens("é")).toBe(1)
    expect(estimateTokens("こんにちは")).toBe(4)
    expect(estimateTokens("😀")).toBe(1)
    expect(estimateTokens("😀a")).toBe(2)
  })

  test("honours a custom bytes-per-token ratio", () => {
    expect(estimateTokens("abcdefgh", 2)).toBe(4)
    expect(estimateTokens("abcdefgh", 8)).toBe(1)
    expect(estimateTokens("abc", 1)).toBe(3)
    expect(estimateTokens("a", 8)).toBe(1)
  })
})

describe("activeDuration", () => {
  test("is zero without samples", () => {
    expect(activeDuration([])).toBe(0)
    expect(activeDuration([], 5000)).toBe(0)
  })

  test("uses the single sample default", () => {
    expect(activeDuration([sample(1000)])).toBe(SINGLE_SAMPLE_MS)
  })

  test("clamps the single sample tail between 250ms and one second", () => {
    expect(activeDuration([sample(1000)], 1100)).toBe(250)
    expect(activeDuration([sample(1000)], 1250)).toBe(250)
    expect(activeDuration([sample(1000)], 1500)).toBe(500)
    expect(activeDuration([sample(1000)], 2000)).toBe(SINGLE_SAMPLE_MS)
    expect(activeDuration([sample(1000)], 9000)).toBe(SINGLE_SAMPLE_MS)
    expect(activeDuration([sample(1000)], 500)).toBe(250)
  })

  test("sums positive gaps between multiple samples", () => {
    expect(activeDuration([sample(0), sample(600), sample(1300)])).toBe(1300)
    expect(activeDuration([sample(0), sample(1500)])).toBe(1500)
  })

  test("enforces a one second minimum for multiple samples", () => {
    expect(activeDuration([sample(0), sample(400)])).toBe(SINGLE_SAMPLE_MS)
    expect(activeDuration([sample(0), sample(200), sample(200)])).toBe(
      SINGLE_SAMPLE_MS,
    )
  })

  test("ignores non-positive gaps between samples", () => {
    expect(activeDuration([sample(500), sample(400)])).toBe(SINGLE_SAMPLE_MS)
    expect(activeDuration([sample(0), sample(1000), sample(900)])).toBe(
      SINGLE_SAMPLE_MS,
    )
  })

  test("includes the tail gap when requested", () => {
    expect(activeDuration([sample(0), sample(600)], 1200)).toBe(1200)
    expect(activeDuration([sample(0), sample(600)], 900)).toBe(1000)
    expect(activeDuration([sample(0), sample(1500)], 2000)).toBe(2000)
    expect(activeDuration([sample(0), sample(1300)], 1000)).toBe(1300)
  })
})

describe("liveRate", () => {
  test("is undefined without samples", () => {
    expect(liveRate([], 10_000)).toBeUndefined()
  })

  test("is undefined when the last sample is stale", () => {
    expect(liveRate([sample(0, 10)], LIVE_STALE_MS + 1)).toBeUndefined()
    expect(liveRate([sample(0, 10)], 10_000, STREAM_WINDOW_MS, 100)).toBeUndefined()
  })

  test("allows a sample exactly at the stale boundary", () => {
    expect(liveRate([sample(0, 10)], LIVE_STALE_MS)).toBeCloseTo(10)
  })

  test("computes a rate for a single fresh sample", () => {
    expect(liveRate([sample(9_500, 10)], 10_000)).toBeCloseTo(20)
  })

  test("uses the active duration and token sum for multiple samples", () => {
    expect(
      liveRate([sample(0, 4), sample(500, 6)], 1_000),
    ).toBeCloseTo(10)
    expect(
      liveRate([sample(0, 12), sample(500, 8)], 1_000),
    ).toBeCloseTo(20)
    expect(
      liveRate([sample(0, 10), sample(1000, 10)], 2_000),
    ).toBeCloseTo(10)
  })

  test("filters samples outside the default window", () => {
    const now = 10_000
    expect(
      liveRate([sample(now - 6_000, 100), sample(now - 1_000, 10)], now),
    ).toBeCloseTo(10)
  })

  test("is undefined when every sample is outside the window", () => {
    expect(liveRate([sample(0, 10)], STREAM_WINDOW_MS + 1)).toBeUndefined()
  })

  test("honours a custom window", () => {
    const now = 10_000
    expect(
      liveRate(
        [sample(now - 2_500, 100), sample(now - 1_000, 5)],
        now,
        2_000,
      ),
    ).toBeCloseTo(5)
  })

  test("honours a custom stale threshold", () => {
    expect(liveRate([sample(9_500, 10)], 10_000, STREAM_WINDOW_MS, 400)).toBeUndefined()
    expect(liveRate([sample(9_500, 10)], 10_000, STREAM_WINDOW_MS, 500)).toBeCloseTo(20)
  })
})
