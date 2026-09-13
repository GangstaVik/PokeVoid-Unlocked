# PokeVoid-Unlocked

[![Release](https://img.shields.io/badge/Release-v1.6.0-blue)](https://github.com/GangstaVik/PokeVoid-Unlocked/releases/tag/v1.6.0)
[![Game](https://img.shields.io/badge/PokeVoid-v3.1.8-purple)](https://www.pokevoid.com)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

A free, open-source userscript that unlocks extra features for the **browser version** of PokeVoid.

## Features

| Feature | Description |
| --- | --- |
| Always Shiny | Force shiny encounters. Bosses, rivals and legendaries are deliberately bypassed. |
| Catch Any | When the capture toggle is active, any Pokéball that the game's native catch gate would reject for a single, non-excluded target is force-injected, and that catch is guaranteed. Throws the game accepts on its own keep native catch odds. |
| Roll Controller | 3 honest toggles operating on real roll values (no cosmetic probabilities), with real itemcount scaling. |
| Skill Tree Editor | Edit skill points for the current run. Event-driven refresh since v1.2.0. |
| Money Override | Set the in-game currency value. BigInt-safe. |
| Voucher Editor | Grant vouchers directly. Available since v1.2.0. |
| Battle tab | Shiny/capture toggles from the battle screen; settings persist between sessions. Available since v1.3.0. |

> UI and utility modules that back these features are listed in [Structure](#structure).

## How to use

1. Install a userscript manager (**Tampermonkey** or **Violentmonkey**).
2. Download [`pokevoid-unlocked.user.js`](pokevoid-unlocked.user.js) from this repository (raw URL) or copy-paste its content into a new userscript.
3. Confirm the installation in the userscript manager.
4. Open pokevoid.com — press **`Ctrl+Shift+P`** (default hotkey, rebindable from the About modal, see `src/ui/hotkey.js`) or click the **PV floating button** in the bottom-right corner to open or close the panel.

> `pokevoid-unlocked.user.js` is generated from `src/` by `node build.js` (bundled, dependency-free) and is committed intentionally.

## Structure

```
src/
├── main.js                    — entry point, panel toggle (Ctrl+Shift+P)
├── i18n.js                    — UI dictionary (t())
├── encounter-override.js      — Always Shiny
├── capture-override.js        — Catch Any guaranteed catch for gate-rejected throws (L2 command wrapper + L1 backstop)
├── roll-controller.js         — Roll Controller (3 toggles + itemcount)
├── skill-tree-editor.js       — Skill Tree Editor
├── money-override.js          — Money Override (BigInt-safe)
├── voucher-editor.js          — Voucher Editor
├── game-bridge.js             — game API bridge
├── phase-observer.js          — battle phase hooks
├── ui/
│   ├── floating-btn.js        — PV-monogram floating action button
│   ├── hotkey.js              — toggle hotkey (rebindable)
│   ├── panel.js               — panel shell
│   ├── battle-screen.js       — battle tab toggles
│   ├── roll-screen.js         — roll controls UI
│   ├── skill-screen.js        — skill editor UI
│   ├── voucher-screen.js      — voucher editor UI
│   └── styles.js              — UI styling
├── utils/
│   ├── config.js              — configuration
│   ├── helpers.js             — shared helpers
│   └── storage.js             — settings persistence
build.js                        — build script (no dependencies)
```

Key entry points and modules by path: `src/ui/floating-btn.js`, `src/game-bridge.js`, `src/phase-observer.js`, `src/utils/storage.js` (full structure above).

## Compatibility

See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) for tested browsers and game builds.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for build steps and automation notes.

## Credits

This project is based on **[JsPoRoMod](https://github.com/PokeRogueMOD/JsPoRoMod)**.

## License

[MIT](LICENSE) © 2026 GangstaVik