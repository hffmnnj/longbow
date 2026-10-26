---
name: Longbow Android
description: Native Flutter client for the Longbow trading harness. Graphite terminal, one steel-blue accent, green and red reserved for money.
colors:
  dark:
    background: "#0D0E11"
    foreground: "#E5E8EC"
    card: "#141619"
    popover: "#1C1E22"
    bar: "#121417"
    secondary: "#1F2225"
    muted: "#1B1D20"
    mutedForeground: "#999FA6"
    accent: "#26292E"
    border: "#2B2E32"
    input: "#52565B"
    primary: "#6DBBE8"
    primaryForeground: "#0D1014"
    destructive: "#F66D67"
    gain: "#5FD37F"
    loss: "#FD736D"
    warn: "#E9B452"
    warnBg: "#362607"
    live: "#6DBBE8"
    lab: "#C2A7F4"
    labBg: "#1C1625"
  light:
    background: "#F6F7F8"
    foreground: "#171B20"
    card: "#FFFFFF"
    popover: "#FFFFFF"
    bar: "#FFFFFF"
    secondary: "#EDF0F2"
    muted: "#EDF0F2"
    mutedForeground: "#555B63"
    accent: "#E7EAED"
    border: "#DBDEE1"
    input: "#BABEC3"
    primary: "#005C96"
    primaryForeground: "#FAFAFA"
    destructive: "#BB0916"
    gain: "#006E30"
    loss: "#BE2323"
    warn: "#975800"
    warnBg: "#FEEDC9"
    live: "#0F69A3"
    lab: "#68449C"
    labBg: "#F2EDFC"
typography:
  sans: IBM Plex Sans
  mono: IBM Plex Mono
  scale:
    display: { size: 34, weight: 600, tracking: -0.6, face: mono-tabular }
    title: { size: 20, weight: 600, tracking: -0.2, face: sans }
    body: { size: 15, weight: 400, face: sans }
    label: { size: 13, weight: 500, face: sans }
    caption: { size: 11.5, weight: 500, face: sans }
    number: { size: 14, weight: 500, face: mono-tabular }
rounded:
  sm: 6
  md: 10
  lg: 14
  xl: 20
spacing:
  unit: 4
  screen: 16
  card: 14
  gap: 12
motion:
  fast: 120ms
  base: 200ms
  sheet: 300ms
  curve: easeOutCubic
---

# Longbow Android design

Native Flutter app that replaces the WebView shell. It speaks to the same server as the web app and shows the same product, built with Material 3 widgets under a custom Longbow theme. Brand coherence with the web app comes from the shared token values above (converted from the web CSS `oklch` variables); everything else is native.

## Overview

A trading terminal that fits in a hand. Graphite surfaces, one steel-blue accent, IBM Plex type with tabular figures so every number lines up. Green and red appear only on money and on buy/sell. Amber marks warnings and halts. Violet marks the simulation lab so paper money never reads as real money. Charts are dithered: a line over an ordered-dither area fill, the same signature as the web app, drawn with `CustomPainter`.

The first screen is a verdict, not a menu: equity, day P&L, whether the agent is working, whether anything needs a human. Detail is one tap or one drag away.

## Colors

Tokens are exposed as a `LongbowColors` `ThemeExtension` (gain, loss, warn, warnBg, live, lab, labBg, bar, mutedForeground, border, input) beside the Material `ColorScheme` built from the same values. Call sites read `context.lb.gain`, never a literal. Text fields use `lbFieldBorder` (a stronger outline than the `input` token, which is only 1.7:1 on light surfaces). Dark is the default; light follows the system when the user picks System in settings. No dynamic wallpaper color: the brand wins.

Color is never the only signal. Gain and loss carry a sign and a minus glyph (U+2212); status chips carry an icon or word.

## Typography

IBM Plex Sans for text, IBM Plex Mono for numbers, both bundled as assets (no runtime fetching). Numbers always use tabular figures and right-align in columns. Never clamp the text scale; layouts flow at the largest accessibility size.

## Layout

Compact phone first, 16dp screen margins, 12dp gaps, 14dp card padding. At 600dp and wider the Feed becomes two panes (transcript and approvals plus portfolio) and lists become grids; content reflows below that. Safe areas come from `MediaQuery`/`SafeArea`; the app draws edge to edge with transparent system bars.

Navigation: a bottom `NavigationBar` with Feed, Portfolio, Markets, Performance, Agent. A "More" action in the top bar opens a menu sheet with Reports, Journal and orders, Lab, and Settings. Symbol, report, run, suite, transcript, note and skill details push full-screen routes; order detail, settings, and the new-simulation forms open as modal bottom sheets with a grabber.

## Components

Material 3 widgets (NavigationBar, FilledButton, SegmentedButton, Switch, ModalBottomSheet, SnackBar) are themed once in `buildLongbowTheme`, so call sites rarely style anything by hand. Import everything from `package:longbow/core/core.dart`. Longbow-specific pieces live in `lib/core/widgets`: `Money`, `PctText`, `Pnl`, `StatusChip` (neutral, live, warn, loss, gain, lab), `ActionBadge`, `SideBadge`, `GradeChip`, `LbCard`, `SectionCard`, `KeyValueRow` and `KeyValueList`, `Empty`, `ErrorState`, `SkeletonBlock` and `SkeletonLines`, `StaleBanner`, `Disclosure`, `PulseDot`, `SectionLabel`, `CodeBlock`; inputs `LbSegmented`, `LbSwitchRow`, `LbTextField`, `LbNumberField`, `LbSliderRow`, `LbSearchField`; overlays `showLbSheet`, `showLbConfirm`, `showToast`; the page frame `LbPageScaffold` (collapsing large title, pull to refresh, safe areas). `LbMarkdown` renders agent markdown. Helpers: `LbMotion`, `Haptics`, `LbIcons` and `LbIcon`, `LbText.number` (tabular mono), and the web-parity formatters in `format.dart`. `DesignGallery` (debug only) shows every widget in every state. Charts live in `lib/core/charts` (see Charts below).

### Charts

Import `lib/core/charts/charts.dart` only; charts take plain Dart inputs and read colors through `ChartPalette` (derived from `context.lb`), never models or design-system widgets.

- `DitherAreaChart`: one series, crisp line over an ordered-dither fill (4x4 Bayer, cell about 2dp snapped to whole physical pixels, grid anchored to the canvas so it never shimmers). Optional dashed `benchmark`, `referenceLines` (stop, entry), `markers` (buy and sell triangles); gain or loss tone by default. Covers equity, price path, VIX and yield history, and the order-card mini chart.
- `MultiLineChart` (named lines plus legend, lab compare), `CurveChart` (categorical line with dots, yield curve), `CandleChart` (candles, volume, SMAs, rules, markers).
- `Sparkline`: tiny, non-interactive, cached path and mask; `benchmark` gives the run-card equity-versus-SPY spark.
- `BarStrip` and `BarStripList` (exposure, sector weight with cap marker, breadth with a 50 marker), `DiffBars` (signed rows on a zero axis), `ColumnChart` (grouped or stacked columns: P&L per trade, calibration buckets), `CalibrationChart` (predicted against realized, diagonal, count-sized dots), `ExcessStrip` (excess return dots per variant).
- Interaction: horizontal drag scrubs (`ChartScrubMode.drag`, starts at touch-down, vertical swipes still scroll the parent) or long-press then drag (`ChartScrubMode.longPress`, for charts inside pagers). `onScrub(int?)` reports the data index, null on release; a readout bubble is built in. A selection haptic fires only when the index lands on a new point, at most every 40 ms.
- Motion: first draw trims the line over 400 ms and fades the fill in; data changes morph over 250 ms; all skipped under `MediaQuery.disableAnimationsOf`.
- Axes: y labels right, at most 4 ticks from `niceTicks`; x labels at most 4, never overlapping; Plex Mono 10.5sp, tabular figures, `mutedForeground`; small boxes drop axes. Every chart has a `semanticsLabel`, defaulting to start, end, change, low and high.

## Behaviors

- Auto connection: the build carries your tailnet hosts (`LONGBOW_HOSTS`, from the gitignored `hosts.local.json`), and each bare host expands to `https://host:8443` and `http://host:4520`. On launch the app probes the saved host, the last host that worked, and those candidates in parallel with `GET /api/status`, prefers HTTPS, remembers the winner, tells the foreground alert service about it, and re-probes on failure and on network change. With no hosts it asks for one. If nothing answers it shows one screen: "Can't reach Longbow" with what was tried, Retry, Open Tailscale and an Advanced host field. It retries by itself every 10 seconds and when the app returns to the foreground.
- Live data: one `GET /api/events` stream (SSE) with backoff reconnect; REST refresh on every (re)connect. Offline shows the last known account with its age.
- Pull to refresh on scrolling data screens. Skeletons reserve the loaded geometry; stale data stays visible while a refresh runs.
- Haptics at commit moments only: approve and reject, kill switch, mode change, sending a message, tab change (selection). Never on scroll. The visual always stands alone.
- Notifications: the existing Kotlin foreground service keeps the trade-alert stream; tapping a notification routes `/?order=`, `?report=`, `?view=` and `?action=kill` to the matching native screen.
- Back unwinds sheets, then routes, then leaves the app; predictive back is on.
- Motion: tab content cross-fades (about 200ms), sheets use the platform spring, the equity number rolls to new values, new feed items ease in. All of it is skipped when `MediaQuery.disableAnimationsOf` is true.

## Surfaces

Feed (live transcript with decision cards and tool traces, composer, approvals, halt banner), Portfolio (equity hero, positions, orders, latest report), Markets (regime, indices, sectors, VIX, yields, breadth, calendar, earnings), Performance (equity vs SPY, trades, calibration, exposure, sectors), Agent control room (fleet, models, cycle controls, subagents, notes, skills), Reports (list and brief), Journal and orders, Lab (runs, suites, compare, new run), Settings (mode, kill switch, risk limits, crypto sleeve, cycle cadence, watchlist, Robinhood connection, notifications, theme, server address).

## Decisions

- 2026-10-26: Replace the WebView shell with a fully native Flutter app; the web app stays as the browser and PWA client. Why: the owner wants native feel, gestures, and performance.
- Material 3 base with a custom ThemeExtension instead of a third-party kit, because Material is mature on Android and the brand lives in tokens.
- Riverpod for state, `http` for REST and SSE, `json_serializable` for models, custom painters for charts. No chart package so the dithered signature matches the web.
- The app talks to the server with the `x-harness: 1` header and no `Origin`, which the server already accepts.
