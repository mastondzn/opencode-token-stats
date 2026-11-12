# @mastondzn/opencode-token-stats

OpenCode V2 TUI plugin that shows configurable session token, cache, cost, context, and throughput stats in the prompt footer.

```
↑343k ↓225k R37M CH99.1% $0.297 33.1%/1.0M 120TPS 12sTTFT
```

The line is rendered in the `prompt.footer.status` slot and updates live while a response streams.

## Install locally

This package is local-only. Point the CLI plugin list at the repository:

```json title="~/.config/opencode/cli.json"
{
  "plugins": ["file:///home/maston/opencode-token-stats"]
}
```

Restart the TUI or let `cli.json` reload.

This is a TUI-only plugin. Configure it in `cli.json`, not `opencode.json`; the server-side plugin scan drops directories without a server entrypoint.

## Segments

Every segment can be toggled from the configure dialog. The default set is:

| Segment | Render | Meaning |
| --- | --- | --- |
| `input` | `↑343k` | Cumulative fresh input tokens, excluding cache reads and writes |
| `output` | `↓225k` | Cumulative visible output plus reasoning tokens |
| `cacheRead` | `R37M` | Cumulative cache-read tokens |
| `cacheHit` | `CH99.1%` | Session-wide `cacheRead / (cacheRead + input)` |
| `cost` | `$0.297` | Session cost from the server |
| `context` | `33.1%/1.0M` | Latest assistant step's context fill over the model limit |
| `tps` | `120TPS` | Live rolling output throughput; exact last-step value when idle |
| `ttft` | `12sTTFT` | Current/last-step time to first token |

Optional segments, off by default:

`cacheWrite` (`W`), `tpsAvg` (`AVG…TPS`), `ttftAvg` (`AVG…TTFT`), `total` (`Σ`), `duration` (`EL`).

## Commands

- Palette command **Token stats: Configure**
- Slash command `/token-stats` (alias `/tokens`)

The configure dialog lists every segment as a checkbox:

- `space` toggles the highlighted segment
- `up` / `down` move
- `p` cycles the placement
- `enter` saves and applies immediately
- `esc` cancels
- `r` restores the `cli.json` baseline
- `a` toggles all segments

Runtime choices persist in plugin storage and override the `cli.json` baseline for this machine.

## Placement

The line can live in three places. Change it with `p` in the configure dialog or with the `placement` option.

| Value | Where | Trade-off |
| --- | --- | --- |
| `composer` | Dedicated full-width row above the prompt | Default; native footer stays intact |
| `footer` | Native `prompt.footer.status` row | Full stats line, but the native footer can clip |
| `footer-compact` | Native `prompt.footer.status` row, shrunk to fit | Native footer mostly intact; stats may reduce to a short prefix |

On an 80-column terminal, the native footer row is already crowded by the location, subagent/shell summary, token/context readout, and palette hints. `composer` is the only placement that reliably shows the whole line there.

## Options

`segments` sets the initial enabled set and display order. `placement` sets the initial placement (`composer`, `footer`, or `footer-compact`). The runtime dialog can then change both without losing the configured order.

```json title="~/.config/opencode/cli.json"
{
  "plugins": [
    {
      "package": "file:///home/maston/opencode-token-stats",
      "options": {
        "segments": ["input", "output", "cacheHit", "context", "tps", "ttft"],
        "placement": "composer"
      }
    }
  ]
}
```

## Behavior

- **Scope:** current session only; subagent sessions are not rolled up.
- **Placement:** configurable as a dedicated composer row, the native footer, or a compact native-footer variant; see [Placement](#placement).
- **Context:** last assistant message with usage after the last completed compaction, respecting the revert boundary. The value includes input, output, reasoning, cache read, and cache write tokens.
- **Cache hit:** session-wide, cache writes excluded from the denominator.
- **Throughput:** live TPS is estimated from stream deltas over a five-second window; once a step ends, the exact provider-reported output + reasoning tokens replace the estimate. TTFT is measured from step start to the first streamed text, reasoning, or tool-input token. Measurements begin when the plugin sees a step stream in the current TUI run; they are not reconstructed from historical messages.
- **Formatting:** compact SI token counts, one-decimal percentages and context, adaptive cost and throughput precision, single-space separators.
- **Colors:** semantic theme colors. Context turns warning above 70% and error above 90%; cache hit turns success at 90%+ and warning below 50%.
- **Overflow:** whole trailing segments are dropped when the measured footer width is too small; numbers are never split.
- **Compatibility:** ignores other TPS plugins such as `oc-tps`; it does not detect, disable, or coordinate with them.

## Development

```sh
bun install
bun run check
```

`bun run check` runs the TypeScript check and the Bun unit tests.
