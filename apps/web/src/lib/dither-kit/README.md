# dither-kit (vendored)

Copied from `dither-kit-svelte` in https://github.com/drvova/dither-ui (MIT, see `LICENSE`).
Kept: cartesian charts (area, line, bar, sparkline, axes, grid, tooltip, legend), the Bayer engine files they import.
Dropped: backgrounds, text effects, controls, overlays, widgets, pie and radar charts.
Local change: `setPaletteTint` in `engine/palette.ts` darkens series lines on light surfaces.
Type fixes: `!` assertions in two Svelte files and `@ts-nocheck` on five engine files, because upstream is written without `noUncheckedIndexedAccess`.
