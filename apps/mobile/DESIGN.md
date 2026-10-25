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
- Back goes back in WebView history when possible, else leaves the app.
- Both fold displays work: `SafeArea` + Scaffold background, no fixed sizes
  except the centred mark artwork; `configChanges` already covers unfold resizes.
