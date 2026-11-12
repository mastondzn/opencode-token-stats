# @mastondzn/opencode-token-stats

OpenCode V2 TUI plugin that shows configurable session token, cache, cost, context, and throughput stats in the prompt footer.

```
↑343k ↓225k R37M CH99.1% $0.297 33.1%/1.0M 120TPS 12sTTFT
```

The line is rendered above the prompt by default and updates live while a response streams. Its placement is configurable.

## Install locally

This package is not published yet. Clone and point the CLI plugin list at the repository:

```json title="~/.config/opencode/cli.json"
{
    "plugins": ["file:///home/user/opencode-token-stats"]
}
```

Restart the TUI or let `cli.json` reload.

This is a TUI-only plugin. Configure it in `cli.json`, not `opencode.json`; the server-side plugin scan drops directories without a server entrypoint.

## Segments

Every segment can be toggled from the configure dialog. The default set is:

| Segment     | Render       | Meaning                                                         |
| ----------- | ------------ | --------------------------------------------------------------- |
| `input`     | `↑343k`      | Cumulative fresh input tokens, excluding cache reads and writes |
| `output`    | `↓225k`      | Cumulative visible output plus reasoning tokens                 |
| `cacheRead` | `R37M`       | Cumulative cache-read tokens                                    |
| `cacheHit`  | `CH99.1%`    | Session-wide `cacheRead / (cacheRead + input)`                  |
| `cost`      | `$0.297`     | Session cost from the server                                    |
| `context`   | `33.1%/1.0M` | Latest assistant step's context fill over the model limit       |
| `tps`       | `120TPS`     | Live rolling output throughput; exact last-step value when idle |
| `ttft`      | `12sTTFT`    | Current/last-step time to first token                           |

Optional segments, off by default:

`cacheWrite` (`W`), `tpsAvg` (`AVG…TPS`), `ttftAvg` (`AVG…TTFT`), `total` (`Σ`), `duration` (`EL`).

## Commands

- Palette command **Token stats: Configure** — native menu for placement, segments, native footer, and reset
- Palette command **Token stats: Placement** — opens the placement picker directly
- Slash command `/token-stats` (alias `/tokens`) — same as Configure

These use OpenCode's native select dialog:

- type to search
- arrow keys move
- `Enter` selects; in the segment list it toggles the highlighted segment and reopens the list
- `Esc` closes
- placement options show `current`; segments show `on` / `off`
- **Reset to cli.json baseline** in the Configure menu restores both placement and segments

Runtime choices persist in plugin storage and override the `cli.json` baseline for this machine.

## Placement

The line can live in three places. Change it from the native placement picker (**Token stats: Placement** or the Configure menu), or with the `placement` option.

| Value            | Where                                            | Trade-off                                                       |
| ---------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `composer`       | Dedicated full-width row above the prompt        | Default; native footer stays intact                             |
| `overlay`        | Inside the prompt box, bottom-right              | oc-tps style; may overlap the prompt border or long input text  |
| `footer`         | Native `prompt.footer.status` row                | Full stats line, but the native footer can clip                 |
| `footer-compact` | Native `prompt.footer.status` row, shrunk to fit | Native footer mostly intact; stats may reduce to a short prefix |

On an 80-column terminal, the native footer row is already crowded by the location, subagent/shell summary, token/context readout, and palette hints. `composer` is the only placement that reliably shows the whole line there.

## Native footer block

OpenCode's native footer block (context/cost, subagent/shell summary, `ctrl+p commands`, and goal) comes from the built-in `opencode.prompt.footer` plugin. It is all-or-nothing, so **Token stats: Configure → Native footer block** controls it:

- **On** (default): the native block is visible.
- **Off**: adds `-opencode.prompt.footer` to `~/.config/opencode/cli.json` and reloads. The native context/cost, subagent/shell summary, `ctrl+p commands`, and goal indicators disappear. This plugin replaces the subagent/shell summary and the agent-cycle hint, so the footer stays useful.
- Toggling it back on removes the directive and restores the native block.

This is the way to avoid showing context/cost twice and to remove the `ctrl+p commands` hint. The trade-off is that the native goal indicator is not restored by this plugin.

If `OPENCODE_CLI_CONFIG_CONTENT` is set and contains a `plugins` array, it overrides `cli.json`; the toggle refuses to edit the file and tells you to update the inline override instead. You can also add or remove `"-opencode.prompt.footer"` in `cli.json` manually.

## Options

`segments` sets the initial enabled set and display order. `placement` sets the initial placement (`composer`, `overlay`, `footer`, or `footer-compact`). The runtime dialog can then change both without losing the configured order.

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
- **Placement:** configurable as a dedicated composer row, an in-prompt bottom-right overlay, the native footer, or a compact native-footer variant; see [Placement](#placement).
- **Native footer block:** can be disabled from the Configure menu to remove the duplicate native context/cost line and the `ctrl+p commands` hint; see [Native footer block](#native-footer-block).
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
bun run format
bun run check
```

Formatting uses Bun's built-in formatter with `prettier.config.js` (4-space indent, single quotes, semicolons, 120 columns). You do not need the Prettier package installed.

`bun run check` runs the TypeScript check, the formatting check, and the Bun unit tests.
