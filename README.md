# PokeVoid-Unlocked

> Userscript nativo per [pokevoid.com](https://pokevoid.com) che espande il sistema di roll modifier e skill tree.

## Stato

🚀 **v1.3.0** — Always Shiny + Capture Any

## Funzionalità

| Modulo | Descrizione |
|--------|-------------|
| **Roll Controller** | Free reroll, override item count, modifica money |
| **Money Override** | Modifica soldi, skill points, vouchers permanenti |
| **Skill Points Editor** | Modifica skill points永久 con bypass prerequisiti |
| **Always Shiny** | Toggle: ogni Pokémon diventa shiny (wild/boss/rival/legendary). Hook `trySetShiny(65536)` |
| **Capture Any** | Toggle: cattura qualsiasi Pokémon (boss, rival, legendary, multi-target). L2 wrapper + L1 fallback |
| **Battle Tab** | Pannello UI per toggle Always Shiny / Capture Any direttamente in battaglia |
| **Voucher Editor** | Modifica quantità voucher |
| **UI Flottante** | Pannello dark theme con acceso/discesa rapida |

## Installazione

1. Installa [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Edge) o [Greasemonkey](https://addons.mozilla.org/en-US/firefox/addon/greasemonkey/) (Firefox)
2. Vai su https://pokevoid.com
3. Crea un nuovo script userscript e incolla il contenuto di `pokevoid-unlocked.user.js`
4. Salva e ricarica la pagina

> ⚠️ **Compatibilità**: testato su build v3.1.8. Potrebbe non funzionare su versioni successive.

## Disclaimer

⚠️ **MODIFICA VALORI DI GIOCO** — Questo script modifica il comportamento del gioco (roll, money, skill points). Usalo a tuo rischio e pericolo.

- Non affiliato con pokevoid.com né con gli sviluppatori del gioco
- Non responsabili di ban, perdita di progressi o altri danni
- Per uso personale e didattico

## Struttura

```
PokeVoid-Unlocked/
├── pokevoid-unlocked.user.js    # Script principale (da installare)
├── src/
│   ├── main.js                  # Entry point
│   ├── game-bridge.js           # Hook su Phaser.Game
│   ├── phase-observer.js        # Observer per fasi di gioco
│   ├── roll-controller.js       # Logica roll override
│   ├── encounter-override.js    # Always Shiny hook (trySetShiny)
│   ├── capture-override.js      # Capture Any (L2 wrapper + L1 fallback)
│   ├── money-override.js        # Override money/skill points
│   ├── skill-tree-editor.js     # Logica skill points
│   ├── voucher-editor.js        # Logica voucher
│   ├── ui/
│   │   ├── panel.js             # Pannello principale
│   │   ├── floating-btn.js      # Bottone flottante
│   │   ├── roll-screen.js       # UI roll controller
│   │   ├── skill-screen.js      # UI skill editor
│   │   ├── voucher-screen.js    # UI voucher editor
│   │   ├── battle-screen.js     # UI Always Shiny / Capture Any
│   │   └── styles.js            # CSS dinamico
│   └── utils/
│       ├── config.js            # Configurazioni
│       ├── storage.js           # Lettura/scrittura save
│       └── helpers.js           # Utility varie
├── docs/
│   ├── design.md                # Design doc (TODO)
│   └── pokevoid-roll-system-re-report.md  # Report RE completo
└── README.md
```

## Report RE

Il report di reverse engineering del roll system si trova in [`docs/pokevoid-roll-system-re-report.md`](docs/pokevoid-roll-system-re-report.md). Contiene:

- 10 AOB hex signature nel bundle v3.1.8
- Mappa completa del roll system (costi, rarità, item count)
- Punti di iniezione e hook consigliati
- Analisi struttura localStorage save

## Licenza

TODO — in fase di definizione (proposta MIT)

## Crediti

- Analisi RE basata su bundle `index-BA2n6IsS.js` (v3.1.8, ~25.7MB)
- Font del gioco: `pokemon-emerald-pro.ttf`, `pkmnems.ttf`
