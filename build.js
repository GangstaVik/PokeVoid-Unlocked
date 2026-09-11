// build.js — Concatena src/ in pokevoid-unlocked.user.js (IIFE singolo file)
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'pokevoid-unlocked.user.js');

// Ordine di build (dependency order)
const FILES = [
  'src/utils/config.js',
  'src/utils/helpers.js',
  'src/utils/storage.js',
  'src/game-bridge.js',
  'src/phase-observer.js',
  'src/roll-controller.js',
  'src/encounter-override.js',
  'src/capture-override.js',
  'src/money-override.js',
  'src/skill-tree-editor.js',
  'src/voucher-editor.js',
  'src/ui/styles.js',
  'src/ui/floating-btn.js',
  'src/ui/roll-screen.js',
  'src/ui/skill-screen.js',
  'src/ui/voucher-screen.js',
  'src/ui/battle-screen.js',
  'src/ui/panel.js',
  'src/main.js',
];

// Header userscript
const HEADER = `// ==UserScript==
// @name         PokeVoid-Unlocked
// @namespace    local.pokevoid-unlocked
// @version      1.3.0
// @description  Skill editor, roll controller, money override per PokéVoid
// @author       PokeRogueMOD
// @match        https://pokevoid.com/*
// @updateURL    https://raw.githubusercontent.com/GangstaVik/PokeVoid-Unlocked/master/pokevoid-unlocked.user.js
// @downloadURL  https://raw.githubusercontent.com/GangstaVik/PokeVoid-Unlocked/master/pokevoid-unlocked.user.js
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

`;

function build() {
  let output = HEADER;

  // Wrappa tutto in un IIFE stretto
  output += '(function() {\n';
  output += '"use strict";\n\n';

  for (const file of FILES) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath)) {
      console.error('File mancante:', file);
      process.exit(1);
    }
    let content = fs.readFileSync(fullPath, 'utf8');
    // Rimuovi commenti di riga all'inizio del modulo (// src/...)
    content = content.replace(/^\/\/ src\/.*\n/m, '');
    output += '// --- ' + file + ' ---\n';
    output += content + '\n\n';
  }

  output += '})();\n';

  fs.writeFileSync(OUT, output, 'utf8');
  console.log('Build completato:', OUT);
  console.log('Dimensione:', (output.length / 1024).toFixed(1), 'KB');
  console.log('Moduli:', FILES.length);
}

build();
