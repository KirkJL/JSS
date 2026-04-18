/**
 * MAIN.JS — Game Orchestrator
 * ----------------------------
 * Ties all systems together. Manages game state, turn loop,
 * input routing, save/load lifecycle, and screen transitions.
 *
 * Architecture:
 *   main.js = thin orchestrator
 *   game/*.js = systems (no knowledge of each other)
 *   ui.js = rendering + input → dispatches to main.js callbacks
 *
 * To extend:
 *   - Add new systems in game/ and wire them in newGame() + endTurn()
 *   - Add era unlock logic in processEra()
 */

// =============================================
// GAME STATE (single source of truth)
// =============================================
let G = null; // active game state — null when on menus

// Seeded PRNG for runtime randomness (separate from world gen)
let rng = null;

// Current UI mode: 'gather' | 'build'
let currentMode = 'gather';
let selectedBuildDef = null;  // building type selected in Build panel

// =============================================
// INITIALISATION
// =============================================

window.addEventListener('DOMContentLoaded', () => {
  initMenu();
  UISystem.init(document.getElementById('game-canvas'), onTileTap);
  bindGameControls();

  // Check for existing save to enable Continue button
  if (SaveSystem.hasSave()) {
    document.getElementById('btn-continue').disabled = false;
  }

  // Handle window resize / orientation change
  window.addEventListener('resize', () => {
    if (G) {
      UISystem.recalcLayout();
      UISystem.setWorld(G.world, G);
      UISystem.render();
    }
  });
});

// =============================================
// MENU
// =============================================

function initMenu() {
  document.getElementById('btn-new-game').addEventListener('click', () => {
    const seed = document.getElementById('seed-input').value.trim();
    startNewGame(seed);
  });

  document.getElementById('btn-continue').addEventListener('click', () => {
    loadGame();
  });

  document.getElementById('btn-how-to-play').addEventListener('click', () => {
    UISystem.showScreen('howto');
  });

  document.getElementById('btn-howto-back').addEventListener('click', () => {
    UISystem.showScreen('menu');
  });

  document.getElementById('btn-new-after-death').addEventListener('click', () => {
    UISystem.showScreen('menu');
  });

  document.getElementById('btn-menu-after-death').addEventListener('click', () => {
    UISystem.showScreen('menu');
  });
}

// =============================================
// GAME SETUP
// =============================================

function startNewGame(seedStr) {
  const world = WorldGen.generate(seedStr);
  initGameState(world, null); // fresh state
  SaveSystem.deleteSave();
  UISystem.showScreen('game');
  UISystem.toast('⛰️ New expedition begun — Seed: ' + world.seed);
  fullRender();
}

function loadGame() {
  const saved = SaveSystem.load();
  if (!saved) {
    UISystem.toast('No valid save found.');
    return;
  }

  // Re-generate world from seed (tiles are saved too but re-generating
  // is cheap and ensures world structure integrity)
  const world = WorldGen.generate(saved.seed);

  // Overwrite tile states from save (depleted, buildings, type changes)
  for (const savedTile of saved.worldTiles) {
    const tile = WorldGen.getTile(world, savedTile.x, savedTile.y);
    if (tile) {
      tile.depleted   = savedTile.depleted;
      tile.type       = savedTile.type;
      tile.buildingId = savedTile.buildingId;
    }
  }

  initGameState(world, saved);
  UISystem.showScreen('game');
  UISystem.toast(`📂 Resumed — Day ${G.day}`);
  fullRender();
}

function initGameState(world, saved) {
  // Seed the runtime RNG with the world seed + day offset
  const dayOffset = saved ? saved.day : 0;
  const rngSeed   = (world.numericSeed + dayOffset * 7919) >>> 0;
  rng = makePRNG(rngSeed);

  G = {
    world,
    seed: world.seed,

    // Time
    day:    saved ? saved.day    : 1,
    year:   saved ? saved.year   : 1,
    season: saved ? saved.season : 0,  // 0=Spring…3=Winter
    era:    saved ? saved.era    : 0,

    // Systems
    tribe:     saved ? TribeSystem.fromSave(saved.tribe)        : TribeSystem.create(),
    resources: saved ? ResourceSystem.fromSave(saved.resources) : ResourceSystem.create(),
    buildings: saved ? BuildingSystem.fromSave(saved.buildings)  : BuildingSystem.create(),
    events:    saved ? EventSystem.fromSave(saved.eventLog ? { history: saved.eventLog } : {})
                     : EventSystem.createState(),

    // Meta
    buildingsPlacedTotal: 0,
    eventLog: saved ? (saved.eventLog || []) : [],
    paused: false,
  };

  // Recalculate storage caps based on placed buildings
  ResourceSystem.recalcCaps(
    G.resources,
    BuildingSystem.getStorageCount(G.buildings)
  );

  UISystem.setWorld(G.world, G);

  // Defer first render until the game screen is visible and has real dimensions
  requestAnimationFrame(() => {
    UISystem.recalcLayout();
    UISystem.render();
  });
}

// Simple seeded PRNG (same algorithm as WorldGen, independent instance)
function makePRNG(seed) {
  let s = seed >>> 0 || 0x6d2b79f5;
  return function() {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================
// TURN LOOP
// =============================================

function endTurn() {
  if (!G || G.paused) return;

  // ---- Advance time ----
  G.day++;
  if (G.day > G.year * 360 + 360) G.year++;  // ~360 days per year
  G.season = Math.floor(((G.day - 1) % 120) / 30); // 4 seasons × 30 days

  // ---- Resource regrowth ----
  ResourceSystem.processTurnRegrowth(G.world.tiles);

  // ---- Building passive effects (farms produce food etc.) ----
  BuildingSystem.processTurn(G.buildings, G.resources);

  // ---- Events ----
  const disasterActive = !!(G.events.activeEvent);
  const eventMsgs = EventSystem.processTurn(
    G.events, G.world, G.tribe, G.resources, G.buildings,
    G.day, G.season, rng
  );

  // ---- Tribe needs ----
  const buildingProxy = BuildingSystem.createProxy(G.buildings);
  const tribeResult = TribeSystem.processTurn(
    G.tribe, G.resources, buildingProxy, G.season, disasterActive
  );

  // ---- World passive (blizzard thaw etc.) ----
  EventSystem.processWorldPassive(G.world);

  // ---- Era progression ----
  processEra();

  // ---- Collect messages ----
  const allMsgs = [...eventMsgs, ...tribeResult.messages];

  // Log to gather panel
  for (const msg of allMsgs) {
    UISystem.logGather(msg.text);
  }

  // ---- Auto-save every 5 turns ----
  if (G.day % 5 === 0) {
    autoSave();
  }

  // ---- Game over? ----
  if (tribeResult.gameOver || G.tribe.population <= 0) {
    gameOver();
    return;
  }

  // ---- Re-render ----
  fullRender();
}

/**
 * Era progression: unlock new buildings / abilities.
 * Stone → Bronze at day 60; Bronze → Iron at day 150; etc.
 */
function processEra() {
  const ERA_THRESHOLDS = [0, 60, 150, 300];
  for (let i = ERA_THRESHOLDS.length - 1; i >= 0; i--) {
    if (G.day >= ERA_THRESHOLDS[i] && G.era < i) {
      G.era = i;
      const eraNames = ['Stone Age', 'Bronze Age', 'Iron Age', 'Classical Age'];
      UISystem.logGather(`🏛️ Era reached: ${eraNames[i]}`);
      UISystem.toast(`🏛️ New era: ${eraNames[i]}!`, 3000);
    }
  }
}

// =============================================
// TILE TAP HANDLER
// =============================================

function onTileTap(tile) {
  if (!G) return;
  const def = WorldGen.TILE_DEFS[tile.type];

  if (currentMode === 'gather') {
    handleGather(tile, def);
  } else if (currentMode === 'build') {
    handleBuild(tile, def);
  }

  // Always update info panel with tapped tile info
  UISystem.setMode(currentMode === 'info' ? 'info' : currentMode);
  UISystem.updateInfoPanel(G.tribe, G.resources, G.buildings);
}

function handleGather(tile, def) {
  if (!def.passable) {
    UISystem.toast('Cannot gather here.');
    return;
  }
  if (tile.buildingId) {
    const b = G.buildings.placed[tile.buildingId];
    const bDef = BuildingSystem.BUILDING_DEFS[b?.defId];
    UISystem.toast(`${bDef?.emoji || '🏗️'} ${bDef?.name || 'Building'} — ${bDef?.description || ''}`);
    return;
  }
  if (tile.depleted) {
    UISystem.toast('Tile depleted — needs time to recover.');
    return;
  }

  const gained = ResourceSystem.gatherTile(tile, G.resources, G.season);
  if (!gained) {
    UISystem.toast(`${def.name} — nothing to gather.`);
    return;
  }

  const parts = [];
  if (gained.food  > 0) parts.push(`+${gained.food} 🌿`);
  if (gained.wood  > 0) parts.push(`+${gained.wood} 🌲`);
  if (gained.stone > 0) parts.push(`+${gained.stone} 🪨`);

  UISystem.logGather(`${def.emoji || def.name}: ${parts.join(' ')}`);
  updateHUDAndRender();
}

function handleBuild(tile, def) {
  if (!selectedBuildDef) {
    UISystem.toast('Select a building from the BUILD panel first.');
    return;
  }

  const result = BuildingSystem.place(
    G.buildings, tile, selectedBuildDef, G.resources, G.era
  );

  if (!result.ok) {
    UISystem.toast('❌ ' + result.reason);
    return;
  }

  // Recalculate storage if needed
  ResourceSystem.recalcCaps(
    G.resources,
    BuildingSystem.getStorageCount(G.buildings)
  );

  G.buildingsPlacedTotal++;
  const bDef = BuildingSystem.BUILDING_DEFS[selectedBuildDef];
  UISystem.logGather(`Built ${bDef.emoji} ${bDef.name} at (${tile.x},${tile.y})`);
  UISystem.toast(`${bDef.emoji} ${bDef.name} built!`);

  selectedBuildDef = null; // deselect after placing
  updateHUDAndRender();
}

// =============================================
// CONTROLS BINDING
// =============================================

function bindGameControls() {
  // End Turn
  document.getElementById('btn-end-turn').addEventListener('click', endTurn);

  // Pause Menu
  document.getElementById('btn-menu').addEventListener('click', () => {
    if (!G) return;
    G.paused = !G.paused;
    document.getElementById('pause-menu').classList.toggle('hidden', !G.paused);
  });

  document.getElementById('btn-resume').addEventListener('click', () => {
    G.paused = false;
    document.getElementById('pause-menu').classList.add('hidden');
  });

  document.getElementById('btn-save-manual').addEventListener('click', () => {
    autoSave();
    UISystem.toast('💾 Game saved!');
  });

  document.getElementById('btn-abandon').addEventListener('click', () => {
    if (confirm('Abandon this run? Progress will be lost.')) {
      SaveSystem.deleteSave();
      G = null;
      UISystem.showScreen('menu');
      document.getElementById('pause-menu').classList.add('hidden');
      document.getElementById('btn-continue').disabled = true;
    }
  });

  // Mode tabs
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentMode = tab.dataset.mode;
      UISystem.setMode(currentMode);

      if (currentMode === 'build' && G) {
        UISystem.updateBuildPanel(G.era, G.resources, selectedBuildDef, (defId) => {
          selectedBuildDef = defId;
          UISystem.updateBuildPanel(G.era, G.resources, selectedBuildDef, () => {});
        });
      }
      if (currentMode === 'info' && G) {
        UISystem.updateInfoPanel(G.tribe, G.resources, G.buildings);
      }
    });
  });
}

// =============================================
// RENDERING HELPERS
// =============================================

function fullRender() {
  if (!G) return;
  // Re-check layout in case canvas was zero-sized on first paint
  const vp = document.getElementById('map-viewport');
  if (vp && vp.clientHeight > 0 && document.getElementById('game-canvas').height === 0) {
    UISystem.recalcLayout();
  }
  UISystem.render();
  UISystem.updateHUD(G.tribe, G.resources, G.day, G.year, G.season, G.era);
  UISystem.updateInfoPanel(G.tribe, G.resources, G.buildings);
  UISystem.updateEventBanner(EventSystem.getPendingWarning(G.events));

  if (currentMode === 'build') {
    UISystem.updateBuildPanel(G.era, G.resources, selectedBuildDef, (defId) => {
      selectedBuildDef = defId;
      UISystem.updateBuildPanel(G.era, G.resources, selectedBuildDef, () => {});
    });
  }
}

function updateHUDAndRender() {
  if (!G) return;
  UISystem.render();
  UISystem.updateHUD(G.tribe, G.resources, G.day, G.year, G.season, G.era);
  if (currentMode === 'build') {
    UISystem.updateBuildPanel(G.era, G.resources, selectedBuildDef, (defId) => {
      selectedBuildDef = defId;
    });
  }
}

// =============================================
// SAVE / LOAD
// =============================================

function autoSave() {
  if (!G) return;
  const ok = SaveSystem.save({
    seed:       G.seed,
    day:        G.day,
    year:       G.year,
    season:     G.season,
    era:        G.era,
    tribe:      G.tribe,
    resources:  G.resources,
    worldTiles: G.world.tiles,
    buildings:  G.buildings,
    eventLog:   G.eventLog,
  });
  const indicator = document.getElementById('btn-autosave-indicator');
  if (indicator) {
    indicator.textContent = ok ? '💾' : '❌';
    setTimeout(() => { if (indicator) indicator.textContent = '💾'; }, 1500);
  }
  if (ok) document.getElementById('btn-continue').disabled = false;
}

// =============================================
// GAME OVER
// =============================================

function gameOver() {
  UISystem.showGameOver({
    day:    G.day,
    year:   G.year,
    season: G.season,
    era:    G.era,
    seed:   G.seed,
    buildingsPlaced: G.buildingsPlacedTotal,
  });
  SaveSystem.deleteSave();
  document.getElementById('btn-continue').disabled = true;
  G = null;
}
