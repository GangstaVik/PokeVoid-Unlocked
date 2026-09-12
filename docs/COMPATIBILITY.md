# Compatibility

PokeVoid-Unlocked is tested against the following environment.

| Component | Version | Notes |
| --- | --- | --- |
| Game | PokeVoid — pokevoid.com (browser build) | Build v3.1.8 (bundle `index-BA2n6IsS.js`, ~25.7 MB) |
| Browser | Chrome / Firefox / Edge (latest) | Chromium-based browsers recommended |
| Userscript manager | Tampermonkey / Violentmonkey | Latest stable release |
| Node.js (build only) | 22 LTS | Run `node build.js`; no dependencies, no `package.json` |

## Notes

- The userscript targets the **browser** version of the game. Downloadable builds are not supported.
- If the game ships a new bundle, the userscript may stop matching until selectors/hooks are updated. Open an issue in that case.
- `pokevoid-unlocked.user.js` is generated from `src/` by `node build.js` (bundled, dependency-free) and is committed intentionally. Rebuild verification: `node build.js` must produce a zero-diff file.
- Known **game-side** console noise (verified against the v3.1.8 bundle, **not** caused by the userscript — no fix is promised or needed):
  - `Canvas2D: Multiple readback operations using getImageData...` — the game reads the canvas without `willReadFrequently` (D1-b). Innocuous warning.
  - LCP attribution (`lcp com triggered by script...`) — caused by parsing the ~25.7 MB game bundle on the main thread. Not a userscript issue.
  - Residual `[LOAD ERROR] initSystem failed` — verified game-side (see design.md "Note verificate"); the game still boots and plays normally.

### Release compatibility

- **v1.5.0**: Catch Special toggle (default OFF) lifts the five scripted/final/legendary/boss exclusions; requires the v1.4 hook set. ETERNATUS/VOID high-HP captures work only when the boss-major lift is accepted (opt-in, default OFF); force-inject deliberately overrides the native VOID_BALL hpRatio gate. Species with isObtainable() false can still fail the native failCatch before the roll despite the force-inject.