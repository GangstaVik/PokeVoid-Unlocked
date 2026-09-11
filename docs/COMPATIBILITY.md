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