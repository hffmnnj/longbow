# Longbow Android shell — design notes

Native Flutter shell around the served Longbow web app (full-screen WebView).
The web app owns every feature; native code owns only chrome around it.

## Tokens

- `background`: `#16191d` — shared everywhere (web `theme-color`, Android
  status/nav bars, native splash, loading overlay, error screen, Scaffold).
- Mark: `assets/longbow-mark.png` (copied from `apps/web/static/brand/`).
- Type/components: Material 3 dark (`ColorScheme.fromSeed`, dark), FilledButton
  with 48dp min height on the error screen, headline/body from the M3 text theme.
- No animations: loading and error are static screens; no motion to reduce.

## Behaviors

- First paint is the Android splash (mark on `#16191d`); the loading overlay
  keeps the identical look until `onPageFinished`, so there is never a white flash.
- Error screen copy is fixed: "Can't reach Longbow" /
  "Check that Tailscale is connected." / Retry. Nothing else.
- Same-origin links stay in the WebView; any other origin opens externally.
- Back dispatches a synthetic Escape into the page first: an open sheet,
  dialog, or menu consumes it and stays put; otherwise back walks WebView
  history, else leaves the app.
- Both fold displays work: `SafeArea` + Scaffold background, no fixed sizes
  except the centred mark artwork; `configChanges` already covers unfold resizes.
- The WebView crossfades in over ~200ms once the first page finishes
  (skipped under reduced motion); pinch zoom is off.

## Native bridge

- The web (`apps/web/src/lib/native.ts`) posts `{ id, method, args }` to the
  `LongbowBridge` JavaScript channel; native answers with
  `window.__longbowReply(<id>, <json>)`. Methods: `haptic`
  (selection/light/medium/heavy/success/warning/error via HapticFeedback),
  `print` (Android PrintManager over the native WebView adapter, found by
  `AndroidWebViewController.webViewIdentifier` over the `longbow/native`
  method channel), `copy` (Clipboard + light haptic), `badge` (no-op;
  launchers show dots from the alert notifications), and
  `notifications.status/enable/disable` (runtime permission, persisted
  toggle, foreground service).
- Pure Dart parsing, reply encoding, and notification-URL routing live in
  `lib/bridge.dart` with device-free unit tests.

## Trade-alerts service

- `AlertsService` (Kotlin, `specialUse` foreground service, "Live trading
  alerts") holds `GET <base>/api/push/native-stream` open, reconnecting with
  2s→60s backoff and waking on connectivity return. Each payload posts on the
  high-importance "Trade alerts" channel; the notification id comes from the
  tag so repeats replace, as web push does. Tapping one opens the app and
  loads `<base><url>` in the WebView, including when already running.
- Its own persistent notification sits on the low-importance "Connection"
  channel: "Longbow" / "Watching for trades", no actions. Small icon is the
  monochrome mark in `res/drawable/ic_alert.xml`. Boot completes restarts it
  when enabled. Permissions: POST_NOTIFICATIONS, FOREGROUND_SERVICE (+
  SPECIAL_USE), RECEIVE_BOOT_COMPLETED, VIBRATE, INTERNET.
