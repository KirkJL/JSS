/**
 * MAIN.JS v2 — Game Orchestrator
 * --------------------------------
 * Wires all systems: world, tribe, resources, buildings, events,
 * morale, merchant, achievements, sound, particles, leaderboard.
 */

let G    = null;
let rng  = null;
let currentMode      = 'gather';
let selectedBuildDef = null;

// Particle system state (canvas-based, lives in main for simplicity)
let particles = [];

// =============================================
// INIT
// =============================================

window.addEventListener('DOMContentLoaded', () => {
  UISystem.init(document.getElementById('game-canvas'), onTileTap);
  SoundSystem.init();
  initMenu();
  bindGameControls();

  if (SaveSystem.hasSave()) {
    document.getElementById('btn-continue').disabled = false;
  }

  window.addEventListener('resize', () => {
    if (G) { UISystem.recalcLayout(); UISystem.setWorld(G.world, G); UISystem.render(); }
  });

  // Particle canvas sizing
  window.addEventListener('resize', resizeParticleCanvas);
});

// =============================================
// MENU
// =============================================

function initMenu() {
  document.getElementById('btn-new-game').addEventListener('click', () => {
    startNewGame(document.getElementById('seed-input').value.trim());
  });
  document.getElementById('btn-continue').addEventListener('click', loadGame);
  document.getElementById('btn-how-to-play').addEventListener('click', () => UISystem.showScreen('howto'));
  document.getElementById('btn-howto-back').addEventListener('click', () => UISystem.showScreen('menu'));
  document.getElementById('btn-new-after-death').addEventListener('click', () => UISystem.showScreen('menu'));
  document.getElementById('btn-menu-after-death').addEventListener('click', () => UISystem.showScreen('menu'));
}

// =============================================
// GAME SETUP
// =============================================

function startNewGame(seedStr) {
  const world = WorldGen.generate(seedStr);
  initGameState(world, null);
  SaveSystem.deleteSave();
  UISystem.showScreen('game');
  resizeParticleCanvas();
  UISystem.toast('⛰️ New expedition — Seed: ' + world.seed);
  forceFirstRender();
}

function loadGame() {
  const saved = SaveSystem.load();
  if (!saved) { UISystem.toast('No valid save found.'); return; }
  const world = WorldGen.generate(saved.seed);
  for (const st of saved.worldTiles) {
    const tile = WorldGen.getTile(world, st.x, st.y);
    if (tile) { tile.depleted = st.depleted; tile.type = st.type; tile.buildingId = st.buildingId; }
  }
  initGameState(world, saved);
  UISystem.showScreen('game');
  resizeParticleCanvas();
  UISystem.toast('📂 Resumed — Day ' + G.day);
  forceFirstRender();
}

function initGameState(world, saved) {
  const dayOffset = saved ? saved.day : 0;
  rng = makePRNG((world.numericSeed + dayOffset * 7919) >>> 0);

  G = {
    world,
    seed:   world.seed,
    day:    saved?.day    ?? 1,
    year:   saved?.year   ?? 1,
    season: saved?.season ?? 0,
    era:    saved?.era    ?? 0,
    prevEra: saved?.era   ?? 0,

    tribe:        saved ? TribeSystem.fromSave(saved.tribe)           : TribeSystem.create(),
    resources:    saved ? ResourceSystem.fromSave(saved.resources)    : ResourceSystem.create(),
    buildings:    saved ? BuildingSystem.fromSave(saved.buildings)     : BuildingSystem.create(),
    events:       saved ? EventSystem.fromSave(saved.eventLog ? { history: saved.eventLog } : {})
                        : EventSystem.createState(),
    morale:       saved?.morale      ? MoraleSystem.fromSave(saved.morale)       : MoraleSystem.create(),
    merchant:     saved?.merchant    ? MerchantSystem.fromSave(saved.merchant)   : MerchantSystem.createState(),
    achievements: saved?.achievements? AchievementSystem.fromSave(saved.achievements) : AchievementSystem.createState(),

    buildingsPlacedTotal: saved?.buildingsPlacedTotal ?? 0,
    eventLog:       saved?.eventLog      ?? [],
    exploredTiles:  saved?.exploredTiles ?? [],
    paused: false,
  };

  ResourceSystem.recalcCaps(G.resources, BuildingSystem.getStorageCount(G.buildings));
  UISystem.setWorld(G.world, G);
}

function forceFirstRender() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const vp = document.getElementById('map-viewport');
    const cv = document.getElementById('game-canvas');
    cv.width  = vp.clientWidth  || window.innerWidth;
    cv.height = vp.clientHeight || Math.floor(window.innerHeight * 0.52);
    UISystem.recalcLayout();
    fullRender();
    updateAchievementsPanel();
  }));
}

function makePRNG(seed) {
  let s = seed >>> 0 || 0x6d2b79f5;
  return () => {
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
  SoundSystem.play('endturn');

  // ---- Time ----
  G.day++;
  if (G.day > G.year * 360 + 360) G.year++;
  G.season  = Math.floor(((G.day - 1) % 120) / 30);
  G.prevEra = G.era;

  // ---- Resource regrowth ----
  ResourceSystem.processTurnRegrowth(G.world.tiles);

  // ---- Building passives ----
  BuildingSystem.processTurn(G.buildings, G.resources);

  // ---- Events ----
  const disasterWasActive = !!(G.events.activeEvent);
  const eventMsgs = EventSystem.processTurn(
    G.events, G.world, G.tribe, G.resources, G.buildings, G.day, G.season, rng
  );
  const disasterFiredThisTurn = !!(G.events.activeEvent);

  if (disasterFiredThisTurn) {
    SoundSystem.play('disaster');
    spawnParticlesBurst(null, 'disaster');
  }

  // ---- Merchant ----
  const merchantMsgs = MerchantSystem.processTurn(G.merchant, G.resources, G.era, rng);
  if (merchantMsgs.some(m => m.banner)) {
    SoundSystem.play('merchant');
    updateMerchantBanner();
  }

  // ---- Tribe ----
  const buildingProxy = BuildingSystem.createProxy(G.buildings);
  const moraleMultipliers = {
    growth: MoraleSystem.growthMultiplier(G.morale),
    decay:  MoraleSystem.decayMultiplier(G.morale),
  };
  const tribeResult = TribeSystem.processTurn(
    G.tribe, G.resources, buildingProxy, G.season, disasterFiredThisTurn, moraleMultipliers
  );

  if (tribeResult.deaths > 0) SoundSystem.play('death');
  if (tribeResult.grew   > 0) SoundSystem.play('growth');

  // ---- Morale ----
  MoraleSystem.processTurn(G.morale, tribeResult, disasterFiredThisTurn, G.era, G.prevEra);

  // ---- World passive ----
  EventSystem.processWorldPassive(G.world);

  // ---- Era ----
  processEra();

  // ---- Achievements ----
  const newAchievements = AchievementSystem.checkAll(G);
  for (const ach of newAchievements) {
    SoundSystem.play('achievement');
    showAchievementToast(ach);
  }

  // ---- Log all messages ----
  const allMsgs = [...eventMsgs, ...merchantMsgs, ...tribeResult.messages];
  for (const msg of allMsgs) UISystem.logGather(msg);

  // ---- Auto-save every 5 turns ----
  if (G.day % 5 === 0) autoSave();

  // ---- Game over? ----
  if (tribeResult.gameOver || G.tribe.population <= 0) { gameOver(); return; }

  // ---- Render ----
  fullRender();
  updateMerchantBanner();
}

function processEra() {
  const thresholds = [0, 60, 150, 300];
  const names      = ['Stone Age', 'Bronze Age', 'Iron Age', 'Classical Age'];
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (G.day >= thresholds[i] && G.era < i) {
      G.era = i;
      UISystem.logGather({ text: `🏛️ Era reached: ${names[i]}`, type: 'good' });
      UISystem.toast(`🏛️ New era: ${names[i]}!`, 3000);
      SoundSystem.play('era');
    }
  }
}

// =============================================
// TILE TAP
// =============================================

function onTileTap(tile) {
  if (!G) return;
  const def = WorldGen.TILE_DEFS[tile.type];
  if (currentMode === 'gather') handleGather(tile, def);
  else if (currentMode === 'build') handleBuild(tile, def);
  UISystem.updateInfoPanel(G.tribe, G.resources, G.buildings);
}

function handleGather(tile, def) {
  if (!def.passable)    { UISystem.toast('Cannot gather here.'); return; }
  if (tile.buildingId) {
    const b    = G.buildings.placed[tile.buildingId];
    const bDef = BuildingSystem.BUILDING_DEFS[b?.defId];
    UISystem.toast(`${bDef?.emoji || '🏗️'} ${bDef?.name} — ${bDef?.description}`);
    return;
  }
  if (tile.depleted) { UISystem.toast('Tile depleted — recovering.'); return; }

  const gained = ResourceSystem.gatherTile(tile, G.resources, G.season);
  if (!gained)   { UISystem.toast(def.name + ' — nothing to gather.'); return; }

  SoundSystem.play('gather');
  const parts = [];
  if (gained.food  > 0) parts.push('+' + gained.food  + ' 🌿');
  if (gained.wood  > 0) parts.push('+' + gained.wood  + ' 🌲');
  if (gained.stone > 0) parts.push('+' + gained.stone + ' 🪨');
  UISystem.logGather({ text: (def.emoji||def.name) + ': ' + parts.join(' '), type:'good' });
  updateHUDAndRender();
}

function handleBuild(tile, def) {
  if (!selectedBuildDef) { UISystem.toast('Select a building first.'); return; }

  const result = BuildingSystem.place(G.buildings, tile, selectedBuildDef, G.resources, G.era);
  if (!result.ok) { UISystem.toast('❌ ' + result.reason); return; }

  ResourceSystem.recalcCaps(G.resources, BuildingSystem.getStorageCount(G.buildings));
  G.buildingsPlacedTotal++;
  const bDef = BuildingSystem.BUILDING_DEFS[selectedBuildDef];
  UISystem.logGather({ text: 'Built ' + bDef.emoji + ' ' + bDef.name, type: 'good' });
  UISystem.toast(bDef.emoji + ' ' + bDef.name + ' built!');
  UISystem.revealAround(tile.x, tile.y, 2);
  SoundSystem.play('build');
  spawnParticlesBurst(tile, 'build');

  selectedBuildDef = null;
  updateHUDAndRender();
}

// =============================================
// CONTROLS
// =============================================

function bindGameControls() {
  document.getElementById('btn-end-turn').addEventListener('click', endTurn);

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
    autoSave(); UISystem.toast('💾 Game saved!');
  });
  document.getElementById('btn-abandon').addEventListener('click', () => {
    if (confirm('Abandon this run?')) {
      SaveSystem.deleteSave(); G = null;
      UISystem.showScreen('menu');
      document.getElementById('pause-menu').classList.add('hidden');
      document.getElementById('btn-continue').disabled = true;
    }
  });

  // Festival
  document.getElementById('btn-festival').addEventListener('click', () => {
    if (!G) return;
    const result = MoraleSystem.holdFestival(G.morale, G.resources);
    if (result.ok) {
      SoundSystem.play('festival');
      UISystem.toast('🎉 Festival! Morale boosted!');
      UISystem.logGather({ text: '🎉 The tribe celebrates!', type: 'good' });
      G.achievements._merchantTraded = true; // reuse flag for festival
      updateHUDAndRender();
    } else {
      UISystem.toast('❌ ' + result.reason);
    }
  });

  // Sound toggle
  document.getElementById('btn-sound').addEventListener('click', () => {
    const nowEnabled = !SoundSystem.isEnabled();
    SoundSystem.setEnabled(nowEnabled);
    document.getElementById('btn-sound').textContent = nowEnabled ? '🔊' : '🔇';
  });

  // Mode tabs
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentMode = tab.dataset.mode;
      UISystem.setMode(currentMode);
      if (currentMode === 'build' && G) refreshBuildPanel();
      if (currentMode === 'info' && G) UISystem.updateInfoPanel(G.tribe, G.resources, G.buildings);
      if (currentMode === 'trade' && G) updateTradePanel();
      if (currentMode === 'achievements' && G) updateAchievementsPanel();
    });
  });

  // Leaderboard submit on game over screen
  document.getElementById('btn-submit-score').addEventListener('click', submitLeaderboardScore);
}

// =============================================
// TRADE PANEL
// =============================================

function updateTradePanel() {
  const el = document.getElementById('trade-content');
  if (!el || !G) return;

  if (!G.merchant.active) {
    el.innerHTML = '<p class="trade-empty">No merchant present. One will arrive eventually...</p>';
    return;
  }

  if (G.merchant.trades.length === 0) {
    el.innerHTML = '<p class="trade-empty">The merchant has nothing left to trade. They leave in ' + G.merchant.turnsLeft + ' turns.</p>';
    return;
  }

  el.innerHTML = '<p class="panel-hint" style="margin-bottom:8px">🐪 Merchant here for ' + G.merchant.turnsLeft + ' more turns</p>';

  for (const trade of G.merchant.trades) {
    const label = MerchantSystem.getTradeLabel(trade);
    const canDo = ResourceSystem.canAfford(G.resources, { [trade.give]: trade.giveAmt });
    const div = document.createElement('div');
    div.className = 'trade-card';
    div.innerHTML = `
      <span class="trade-label">${label}</span>
      <button class="btn btn-primary" ${canDo ? '' : 'disabled'}>TRADE</button>`;
    div.querySelector('button').addEventListener('click', () => {
      const res = MerchantSystem.executeTrade(G.merchant, trade.id, G.resources, G.morale);
      if (res.ok) {
        G.achievements._merchantTraded = true;
        SoundSystem.play('merchant');
        UISystem.toast('🐪 Trade complete!');
        updateTradePanel();
        updateHUDAndRender();
      } else {
        UISystem.toast('❌ ' + res.reason);
      }
    });
    el.appendChild(div);
  }
}

function updateMerchantBanner() {
  const banner = document.getElementById('merchant-banner');
  if (!banner || !G) return;
  if (G.merchant.active) {
    banner.classList.remove('hidden');
    document.getElementById('merchant-text').textContent =
      '🐪 Merchant is here! (' + G.merchant.turnsLeft + ' turns left) — Check TRADE tab.';
  } else {
    banner.classList.add('hidden');
  }
}

// =============================================
// ACHIEVEMENTS PANEL
// =============================================

function updateAchievementsPanel() {
  const el = document.getElementById('achievements-content');
  if (!el || !G) return;
  const all = AchievementSystem.getAll(G.achievements.unlocked);
  el.innerHTML = '';
  // Unlocked first, then locked
  const sorted = [...all.filter(a=>a.unlocked), ...all.filter(a=>!a.unlocked)];
  for (const ach of sorted) {
    const div = document.createElement('div');
    div.className = 'achievement-item' + (ach.unlocked ? ' unlocked' : '');
    div.innerHTML = `
      <span class="ach-icon">${ach.emoji}</span>
      <div class="ach-info">
        <div class="ach-name">${ach.name}</div>
        <div class="ach-desc">${ach.desc}</div>
      </div>`;
    el.appendChild(div);
  }
}

function showAchievementToast(ach) {
  const el = document.createElement('div');
  el.className = 'toast-achievement';
  el.innerHTML = `${ach.emoji} Achievement Unlocked!<br><span style="font-size:12px;font-weight:400">${ach.name}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// =============================================
// PARTICLES
// =============================================

function resizeParticleCanvas() {
  const pc = document.getElementById('particle-canvas');
  const vp = document.getElementById('map-viewport');
  if (!pc || !vp) return;
  pc.width  = vp.clientWidth  || window.innerWidth;
  pc.height = vp.clientHeight || 300;
}

function spawnParticlesBurst(tile, type) {
  const pc = document.getElementById('particle-canvas');
  if (!pc || !G) return;

  let cx = pc.width  / 2;
  let cy = pc.height / 2;

  // If a tile was given, try to get its screen position
  if (tile) {
    // We don't have direct access to UISystem internals, use centre as fallback
    // (A future improvement: expose UISystem.tileToScreen(tile))
  }

  const count  = type === 'disaster' ? 30 : 18;
  const colors = type === 'disaster'
    ? ['#e74c3c', '#e67e22', '#f39c12', '#c0392b']
    : ['#f39c12', '#2ecc71', '#3498db', '#ecf0f1'];

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3.5;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (type === 'disaster' ? 0 : 2),
      life: 1,
      decay: 0.025 + Math.random() * 0.03,
      radius: 2 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }

  if (particles.length > 0 && !particleRAF) tickParticles();
}

let particleRAF = null;

function tickParticles() {
  const pc  = document.getElementById('particle-canvas');
  if (!pc) { particleRAF = null; return; }
  const pctx = pc.getContext('2d');

  pctx.clearRect(0, 0, pc.width, pc.height);

  particles = particles.filter(p => p.life > 0);
  for (const p of particles) {
    p.x    += p.vx;
    p.y    += p.vy;
    p.vy   += 0.12; // gravity
    p.life -= p.decay;
    pctx.globalAlpha = Math.max(0, p.life);
    pctx.fillStyle   = p.color;
    pctx.beginPath();
    pctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    pctx.fill();
  }
  pctx.globalAlpha = 1;

  if (particles.length > 0) {
    particleRAF = requestAnimationFrame(tickParticles);
  } else {
    particleRAF = null;
    pctx.clearRect(0, 0, pc.width, pc.height);
  }
}

// =============================================
// LEADERBOARD
// =============================================

function submitLeaderboardScore() {
  const nameInput = document.getElementById('leaderboard-name-input');
  const name = (nameInput?.value || '').trim() || 'Survivor';
  const statusEl = document.getElementById('leaderboard-status');
  if (statusEl) statusEl.textContent = 'Submitting...';

  const stats = window._lastGameOverStats;
  if (!stats) return;

  LeaderboardSystem.submitScore(
    { name, days: stats.day, seed: stats.seed, era: stats.era },
    ({ ok, rank, error }) => {
      if (ok) {
        if (statusEl) statusEl.textContent = `You ranked #${rank}! 🏆`;
        loadAndShowLeaderboard(rank);
      } else {
        if (statusEl) statusEl.textContent = 'Could not connect to leaderboard.';
      }
    }
  );
}

function loadAndShowLeaderboard(highlightRank) {
  LeaderboardSystem.fetchScores().then(scores => {
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const ERA_NAMES = ['Stone', 'Bronze', 'Iron', 'Classical'];

    scores.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'lb-row' + (highlightRank === i + 1 ? ' highlight' : '');
      row.innerHTML = `
        <span class="lb-rank">#${i+1}</span>
        <span class="lb-name">${s.name}</span>
        <span class="lb-days">${s.days}d</span>
        <span style="font-size:10px;color:var(--text-dim);margin-left:4px">${ERA_NAMES[s.era]||''}</span>`;
      listEl.appendChild(row);
    });

    if (scores.length === 0) {
      listEl.innerHTML = '<p style="font-size:12px;color:var(--text-dim)">No scores yet. Be the first!</p>';
    }
  });
}

// =============================================
// RENDERING
// =============================================

function fullRender() {
  if (!G) return;
  const vp = document.getElementById('map-viewport');
  if (vp && vp.clientHeight > 0 && document.getElementById('game-canvas').height === 0) {
    UISystem.recalcLayout();
  }
  UISystem.render();
  UISystem.updateHUD(G.tribe, G.resources, G.day, G.year, G.season, G.era, G.morale);
  UISystem.updateInfoPanel(G.tribe, G.resources, G.buildings);
  UISystem.updateEventBanner(EventSystem.getPendingWarning(G.events));
  updateMoraleHUD();
  if (currentMode === 'build')         refreshBuildPanel();
  if (currentMode === 'trade')         updateTradePanel();
  if (currentMode === 'achievements')  updateAchievementsPanel();
}

function updateHUDAndRender() {
  if (!G) return;
  UISystem.render();
  UISystem.updateHUD(G.tribe, G.resources, G.day, G.year, G.season, G.era, G.morale);
  updateMoraleHUD();
  if (currentMode === 'build') refreshBuildPanel();
  if (currentMode === 'trade') updateTradePanel();
}

function updateMoraleHUD() {
  if (!G) return;
  const fill = document.getElementById('morale-bar-fill');
  if (!fill) return;
  const m = G.morale.morale;
  const color = m >= 60 ? '#2ecc71' : m >= 30 ? '#f39c12' : '#c0392b';
  fill.style.width      = m + '%';
  fill.style.background = color;
  fill.title = MoraleSystem.getLabel(m);
}

function refreshBuildPanel() {
  UISystem.updateBuildPanel(G.era, G.resources, selectedBuildDef, defId => {
    selectedBuildDef = defId;
    UISystem.updateBuildPanel(G.era, G.resources, selectedBuildDef, () => {});
  });
}

// =============================================
// SAVE
// =============================================

function autoSave() {
  if (!G) return;
  const ok = SaveSystem.save({
    seed: G.seed, day: G.day, year: G.year, season: G.season, era: G.era,
    tribe:          G.tribe,
    resources:      G.resources,
    worldTiles:     G.world.tiles,
    buildings:      G.buildings,
    eventLog:       G.eventLog,
    exploredTiles:  G.exploredTiles || [],
    growthAccumulator: TribeSystem.getAccumulator(),
    morale:         G.morale,
    merchant:       G.merchant,
    achievements:   G.achievements,
    buildingsPlacedTotal: G.buildingsPlacedTotal,
  });
  const ind = document.getElementById('btn-autosave-indicator');
  if (ind) { ind.textContent = ok ? '💾' : '❌'; setTimeout(()=>{ if(ind) ind.textContent='💾'; }, 1500); }
  if (ok) document.getElementById('btn-continue').disabled = false;
}

// =============================================
// GAME OVER
// =============================================

function gameOver() {
  const stats = {
    day:    G.day,   year:   G.year,
    season: G.season, era:   G.era,
    seed:   G.seed,
    tilesExplored:   UISystem.getExploredCount(),
    buildingsPlaced: G.buildingsPlacedTotal,
  };
  window._lastGameOverStats = stats;

  UISystem.showGameOver(stats);
  SaveSystem.deleteSave();
  document.getElementById('btn-continue').disabled = true;

  // Load leaderboard scores for display (submit is user-triggered)
  loadAndShowLeaderboard(null);

  G = null;
}
