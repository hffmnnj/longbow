---
version: alpha
name: Longbow
description: Graphite trading terminal for one owner-operated Robinhood account. Feed-first, terminal-quiet, never cute.
colors:
  primary: "oklch(0.46 0.12 245)"
  on-primary: "oklch(0.985 0 0)"
  secondary: "oklch(0.953 0.004 250)"
  neutral: "oklch(0.975 0.002 250)"
  surface: "oklch(1 0 0)"
  on-surface: "oklch(0.22 0.012 255)"
  muted: "oklch(0.47 0.015 255)"
  error: "oklch(0.5 0.2 27)"
  gain: "oklch(0.47 0.13 150)"
  loss: "oklch(0.52 0.19 27)"
  warn: "oklch(0.52 0.12 65)"
  warn-bg: "oklch(0.95 0.05 85)"
  live: "oklch(0.55 0.13 245)"
  lab: "oklch(0.47 0.14 300)"
  lab-bg: "oklch(0.955 0.02 300)"
  accent: "oklch(0.935 0.006 250)"
  on-accent: "oklch(0.22 0.012 255)"
typography:
  body:
    fontFamily: IBM Plex Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: IBM Plex Sans
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: IBM Plex Sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1
  status:
    fontFamily: IBM Plex Sans
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
rounded:
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px
spacing:
  unit: 4px
  gap: 12px
  card: 14px
  screen: 16px
components:
  page:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 14px
  caption:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    typography: "{typography.body-sm}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 10px
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 10px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
  input-error:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error}"
  user-bubble:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
  activity-title:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
  activity-meta:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.muted}"
    typography: "{typography.body-sm}"
  latest-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
  live-status:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.live}"
    typography: "{typography.status}"
  pnl-gain:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.gain}"
    typography: "{typography.body}"
  pnl-loss:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.loss}"
    typography: "{typography.body}"
  halt-banner:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn}"
    typography: "{typography.body-sm}"
  lab-note:
    backgroundColor: "{colors.lab-bg}"
    textColor: "{colors.lab}"
    typography: "{typography.body}"
---

# Longbow

## Overview

- **What it is, in one line:** A graphite trading terminal for one owner-operated Robinhood account.
- **Who uses it, where, how often:** The account owner, on desktop web and an Android phone, many times on trading days.
- **The one job of the main screen:** Show what the agent is doing and what changed, oldest at top, newest at the bottom.
- **Voice:** Plain, precise, terminal. Never cute.
- **Signature element:** The chronological activity feed: each Code Mode script and its result as one in-place group, plus dithered equity charts.
- **Things true of this product and no competitor (8-12):** One steel-blue accent for all live action; green and red appear only on money and carry a sign; amber means halt, violet means paper lab; every tool call renders as a sentence with its duration; Script and Result live inside the same activity group; decisions carry risk checks inline; approvals and a kill switch sit one tap away; the lab is visually fenced off from real money; IBM Plex Mono with tabular figures everywhere; charts are dithered lines, never glossy areas.
- **Platforms and stack:** SvelteKit web app (shadcn-svelte + bits-ui) and PWA; native Android app (Flutter, Material 3); Hugeicons on both; no chart package (custom painters match the dithered signature).
- **Token source of truth:** The code (`apps/web/src/app.css`); this file mirrors it. Edit both together. The Android app converts the same values to hex (`apps/mobile/DESIGN.md`).
- **Reference images:** None; direction reverse-engineered from the shipped code.

## Colors

One steel-blue accent for live action; the page steps down one tone for cards. Green and red are money-only and always carry a sign or word, never color alone. Amber marks halts, violet marks the simulation lab so paper never reads as real.

- **Primary:** The steel-blue action color; one primary button per screen.
- **Neutral and surface:** Page ground and the one tone step up for cards.
- **On-surface and muted:** Ink and secondary text; muted pairs with surface and neutral at small sizes.
- **Status colors:** `error`, `gain`, `loss`, `warn`, `live` are status only, never decoration; failure also names itself in words.
- **Dark mode:** Follows the system. Dark overrides:

| Token | Dark value |
| --- | --- |
| primary | oklch(0.76 0.1 235) |
| on-primary | oklch(0.17 0.01 255) |
| secondary | oklch(0.25 0.008 255) |
| neutral | oklch(0.165 0.006 255) |
| surface | oklch(0.2 0.007 255) |
| on-surface | oklch(0.93 0.006 250) |
| muted | oklch(0.7 0.012 250) |
| error | oklch(0.7 0.17 25) |
| gain | oklch(0.78 0.16 150) |
| loss | oklch(0.72 0.17 25) |
| warn | oklch(0.8 0.13 80) |
| warn-bg | oklch(0.28 0.05 80) |
| live | oklch(0.76 0.1 235) |
| lab | oklch(0.78 0.11 300) |
| lab-bg | oklch(0.215 0.03 300) |
| accent | oklch(0.28 0.01 255) |

## Typography

IBM Plex Sans for text, IBM Plex Mono for numbers, code, and durations; figures always tabular. Three component sizes plus a status size; report headlines step from 26px to 32px on wider screens. Never clamp the text scale; rows wrap.

## Layout

Single centered column (feed caps near 768px), 4px base unit, 16px page margins, 14px card padding, 12px gaps. Dense tool, not a spacious page. Bottom sheets stay within dynamic viewport bounds; desktop dialogs center.

## Elevation & Depth

Hierarchy comes from borders and tone steps, not shadows. Shadows appear only on floating layers (Latest pill, sheets, toasts). No glass, no blur anywhere.

## Shapes

Controls (buttons, inputs, segmented tabs) at 6px, cards at 8px, chat bubbles and sheets at 12px, pills and status dots fully round. Inner radii never exceed their container. Nothing else is round.

## Components

- **Button:** Primary for the one main action per screen, secondary for the rest. Destructive only with confirmation. Never two primaries side by side.
- **Activity group:** Outcome word once in the title (`Using tools`, `Tools completed`, `Tool run failed`); count, elapsed time, current call, and failure count in the wrappable secondary line. Never truncate mid-fact and never repeat the failure in both slots.
- **Details:** One collapsed disclosure per group with Script/Result tabs, bounded height, selectable and copyable text.
- **Tool line:** Family icon, sentence title, per-call duration or first line; delegate rows link the subagent transcript; order rows show risk checks. Never sum parallel durations into a fake wall time.
- **Latest pill:** Jump-to-latest with a new-activity count; appears only when scrolled up.
- **User bubble:** Right-aligned accent bubble; long text collapses behind Show more.
- **Halt banner / lab note:** Full-width tinted strips; halts amber, lab violet, each labeled in words.

## Do's and Don'ts

- Do lead activity headers with the outcome word once and put counts in the secondary slot (because titles truncate and duplicates crowd narrow widths).
- Do reconcile REST against the request baseline and let only mid-flight stream replacements win (because a missed event must never freeze a stale record).
- Do mark the feed loaded when messages settle, not when every read finishes (because slow unrelated reads must not gate the transcript).
- Do trust delivered SSE status for terminal cleanup (because the server orders snapshots around stream events).
- Don't sum parallel per-call durations (because overlap overstates wall time).
- Don't render Script/Output as peer rows (because they read as tool calls).
- Don't add tokens or components outside this file (because exporters and later workers drift from them).

## Behaviors

- **Loading:** Skeletons reserve the loaded geometry; stale data stays visible while a refresh runs in the background.
- **Empty:** `No messages yet. Run a cycle or say something.` plus the composer; never a blank screen.
- **Error:** Feed-level error with Retry when primary history fails; toasts for failed actions with the server message attached.
- **Offline:** Stale banner with data age; cached equity stays on screen; refresh and stream reconnect on their own.
- **First run:** Empty state plus composer; nothing auto-sends.
- **Panels and overlays:** Bottom sheets on phone, centered dialogs on desktop; the composer stays pinned; the Latest pill is the only floating feed control.
- **Hover, focus, selection:** Visible keyboard focus everywhere; hover never the only affordance; transcript text selectable with Copy on raw script and output.
- **Motion:** About 200ms, transform/opacity only, interruptible; skipped under reduced motion. New rows ease in once; streaming text never animates per tick.
- **Feed follow:** The viewport sticks to the bottom only while the reader is already there; scrolled-up readers get a Latest pill with a new-item count. Expanding Details never moves the scroll.
- **Refresh authority:** Each fetch reconciles fetched records against the request baseline: untouched records take the fetch, records replaced mid-flight keep the stream copy, entries on one side only are kept. A status event that lands mid-refresh outranks the fetch that started before it. Late responses from a stopped or replaced connection are dropped. No durable second source of truth, no optimistic ordering.
- **Activity timing:** Header time is generation-to-result elapsed, labeled `elapsed`, never execution time; per-call durations stay on their lines.
- **Compaction:** Native compaction history renders as a compact neutral `Context compacted` activity, never as a chat bubble; a compacting or failed lead compaction drives a transient card; raw summaries and checkpoints never render.

## Surfaces

### Feed

- **Job:** The chronological transcript with decision cards and tool traces, plus composer, approvals, and halt state.
- **Deviations:** Max-width centered column; sticky bottom composer; Latest pill for jump-to-latest; activity groups inline, never pinned.

## Decisions

| Date | Decision | Why |
| --- | --- | --- |
| 2026-11-11 | Settings offers the current Android build from the same origin: `GET /download/longbow.apk` | The server streams the published APK as an attachment (404 until published); web links same-origin so the build always matches the server, and Android opens the connected server's URL in the external browser, disabled while disconnected with a toast on failure. |
| 2026-11-10 | Details disclosure per activity group with Script/Result tabs | Trailing Script/Output rows masqueraded as tool calls and split one outcome across three rows (QA screenshots). |
| 2026-11-10 | Outcome-once headers with wrappable count/elapsed metadata | Title and description repeated `N failed` and truncated mid-fact on narrow widths (QA screenshots). |
| 2026-11-10 | Reconcile REST against request baseline; loaded on messages; drop late responses from dead connections | Blind replace wiped mid-flight stream data; gating the transcript on every read hid primary history; stale tasks published after stop/replace. |
| 2026-11-10 | Elapsed labels and no duration sums; trust delivered SSE status | Header wall time includes model scheduling, and parallel calls overlap, so sums and bare durations misread; the server orders snapshots around stream events. |
