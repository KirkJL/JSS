/**
 * MAIN.JS — Game Orchestrator
 * ---------------------------
 * Additive overhaul:
 * - villager task assignment
 * - strategy buildings
 * - resource pressure
 * - discovery rewards
 * - stronger merchant
 * - morale gameplay impact
 * - insane run moments
 * - better end screen / leaderboard payload
 * - safer save payloads with visible seed
 */

let G = null;
let rng = null;
let currentMode = 'gather';
let selectedBuildDef = null;
let particles = [];
let particleRAF = null;

window.addEventListener('DOMContentLoaded', () => {
  UISystem.init(document.getElementById('game-canvas'), onTileTap);
  SoundSystem.init();
  initMenu();
  bindGameControls();

  if (SaveSystem.hasSave()) document.getElementById('btn-continue').disabled = false;

  window.addEventListener('resize', () => {
    if (G) {
      UISystem.recalcLayout();
      UISystem.setWorld(G.world, G);
      UISystem.render();
    }
  });

  window.addEventListener('resize', resizeParticleCanvas);
});

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
  for (const st of saved.worldTiles || []) {
    const tile = WorldGen.getTile(world, st.x, st.y);
    if (!tile) continue;
    tile.depleted = !!st.depleted;
    tile.depletedIn = st.depletedIn || 0;
    tile.type = st.type;
    tile.buildingId = st.buildingId;
    tile.originalType = st.originalType || st.type;
    tile.special = st.special || tile.special || null;
    tile.specialClaimed = !!st.specialClaimed;
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

  const tribe = saved ? TribeSystem.fromSave(saved.tribe) : TribeSystem.create();
  const resources = saved ? ResourceSystem.fromSave(saved.resources) : ResourceSystem.create();
  const buildings = saved ? BuildingSystem.fromSave(saved.buildings) : BuildingSystem.create();
  const morale = saved?.morale ? MoraleSystem.fromSave(saved.morale) : MoraleSystem.create();
  const merchant = saved?.merchant ? MerchantSystem.fromSave(saved.merchant) : MerchantSystem.createState();
  const achievements = saved?.achievements ? AchievementSystem.fromSave(saved.achievements) : AchievementSystem.createState();
  const events = saved?.events ? EventSystem.fromSave(saved.events) :
    EventSystem.fromSave(saved?.eventLog ? { history: saved.eventLog } : EventSystem.createState());

  const startTile = WorldGen.findStartTile(world);

  G = {
    world,
    seed: world.seed,
    day: saved?.day ?? 1,
    year: saved?.year ?? 1,
    season: saved?.season ?? 0,
    era: saved?.era ?? 0,
    prevEra: saved?.era ?? 0,
    tribe,
    resources,
    buildings,
    events,
    morale,
    merchant,
    achievements,
    villagers: initVillagers(saved?.villagers, tribe.population, startTile),
    selectedVillagerId: saved?.selectedVillagerId ?? null,
    buildingsPlacedTotal: saved?.buildingsPlacedTotal ?? 0,
    eventLog: saved?.eventLog ?? [],
    exploredTiles: saved?.exploredTiles ?? [],
    paused: false,
    merchantBlueprints: saved?.merchantBlueprints ?? [],
    runStats: {
      maxPopulation: saved?.runStats?.maxPopulation ?? tribe.population,
      minPopulation: saved?.runStats?.minPopulation ?? tribe.population,
      specialFinds: saved?.runStats?.specialFinds ?? 0,
      merchantTrades: saved?.runStats?.merchantTrades ?? 0,
      nearDeathTurns: saved?.runStats?.nearDeathTurns ?? 0,
      lastStandUsed: saved?.runStats?.lastStandUsed ?? false,
      comebackScore: saved?.runStats?.comebackScore ?? 0,
      populationRecovered: saved?.runStats?.populationRecovered ?? 0,
      objective: saved?.runStats?.objective || 'Reach Day 50 and keep the tribe alive.',
      causeOfDeath: saved?.runStats?.causeOfDeath || '',
      insaneMoments: saved?.runStats?.insaneMoments ?? [],
    },
  };

  ResourceSystem.recalcCaps(G.resources, BuildingSystem.getStorageCount(G.buildings));
  syncVillagersToPopulation();
  if (!G.selectedVillagerId && G.villagers[0]) G.selectedVillagerId = G.villagers[0].id;
  UISystem.setWorld(G.world, G);
}

function initVillagers(savedVillagers, population, startTile) {
  if (Array.isArray(savedVillagers) && savedVillagers.length) return savedVillagers;
  const workers = Math.max(1, Math.min(8, Math.ceil(population / 3)));
  const villagers = [];
  for (let i = 0; i < workers; i++) {
    villagers.push({
      id: 'v' + (i + 1),
      name: 'Villager ' + (i + 1),
      x: startTile?.x ?? 0,
      y: startTile?.y ?? 0,
      task: null,
      lastResult: 'Idle',
    });
  }
  return villagers;
}

function syncVillagersToPopulation() {
  if (!G) return;
  const desired = Math.max(1, Math.min(8, Math.ceil(G.tribe.population / 3)));
  const startTile = WorldGen.findStartTile(G.world);

  while (G.villagers.length < desired) {
    const idx = G.villagers.length + 1;
    G.villagers.push({
      id: 'v' + idx,
      name: 'Villager ' + idx,
      x: startTile?.x ?? 0,
      y: startTile?.y ?? 0,
      task: null,
      lastResult: 'Idle',
    });
  }
  while (G.villagers.length > desired) {
    const removed = G.villagers.pop();
    if (removed && G.selectedVillagerId === removed.id) G.selectedVillagerId = G.villagers[0]?.id || null;
  }
}

function getSelectedVillager() {
  return G?.villagers?.find(v => v.id === G.selectedVillagerId) || null;
}

function forceFirstRender() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const vp = document.getElementById('map-viewport');
    const cv = document.getElementById('game-canvas');
    cv.width = vp.clientWidth || window.innerWidth;
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

function endTurn() {
  if (!G || G.paused) return;
  SoundSystem.play('endturn');

  G.day++;
  G.year = Math.floor((G.day - 1) / 120) + 1;
  G.season = Math.floor(((G.day - 1) % 120) / 30);
  G.prevEra = G.era;

  ResourceSystem.processTurnRegrowth(G.world.tiles);

  const buildingMessages = BuildingSystem.processTurn(G.buildings, G.resources, G.morale);
  const buildingProxy = BuildingSystem.createProxy(G.buildings);
  const pressureMessages = ResourceSystem.applyTurnPressure(G.resources, G.season, G.tribe.population, buildingProxy);
  const villagerMessages = processVillagersTurn();

  const eventMsgs = EventSystem.processTurn(
    G.events, G.world, G.tribe, G.resources, G.buildings, G.day, G.season, rng
  );

  const disasterFiredThisTurn = !!G.events.activeEvent;
  if (disasterFiredThisTurn) {
    SoundSystem.play('disaster');
    spawnParticlesBurst(null, 'disaster');
  }

  const merchantMsgs = MerchantSystem.processTurn(G.merchant, G.resources, G.era, rng, G.morale, buildingProxy);
  if (merchantMsgs.some(m => m.banner)) {
    SoundSystem.play('merchant');
    updateMerchantBanner();
  }

  const moraleMultipliers = {
    growth: MoraleSystem.growthMultiplier(G.morale),
    decay: MoraleSystem.decayMultiplier(G.morale),
    death: MoraleSystem.getDeathMultiplier(G.morale),
  };

  const tribeResult = TribeSystem.processTurn(
    G.tribe, G.resources, buildingProxy, G.season, disasterFiredThisTurn, moraleMultipliers
  );

  if (tribeResult.deaths > 0) SoundSystem.play('death');
  if (tribeResult.grew > 0) SoundSystem.play('growth');

  MoraleSystem.processTurn(G.morale, tribeResult, disasterFiredThisTurn, G.era, G.prevEra, buildingProxy);

  maybeTriggerLastStand(tribeResult);
  EventSystem.processWorldPassive(G.world);
  processEra();
  syncVillagersToPopulation();
  updateRunStats(tribeResult);

  const newAchievements = AchievementSystem.checkAll(G);
  for (const ach of newAchievements) {
    SoundSystem.play('achievement');
    showAchievementToast(ach);
  }

  const allMsgs = [...buildingMessages, ...pressureMessages, ...villagerMessages, ...eventMsgs, ...merchantMsgs, ...tribeResult.messages];
  for (const msg of allMsgs) UISystem.logGather(msg);

  if (G.day % 5 === 0) autoSave();

  if (tribeResult.gameOver || G.tribe.population <= 0) {
    G.runStats.causeOfDeath = tribeResult.cause || G.tribe.causeOfDeath || 'The mountain won.';
    gameOver();
    return;
  }

  fullRender();
  updateMerchantBanner();
}

function processVillagersTurn() {
  if (!G) return [];
  const msgs = [];
  const gatherMultiplier = MoraleSystem.getGatherMultiplier(G.morale);

  for (const villager of G.villagers) {
    if (!villager.task || villager.task.type !== 'gather') {
      villager.lastResult = 'Idle';
      continue;
    }
    const tile = WorldGen.getTile(G.world, villager.task.x, villager.task.y);
    if (!tile) {
      villager.task = null;
      villager.lastResult = 'Lost task';
      continue;
    }
    villager.x = tile.x;
    villager.y = tile.y;

    if (tile.buildingId) {
      villager.lastResult = 'Blocked by building';
      continue;
    }

    const bonus = BuildingSystem.getGatherBonus(G.buildings, tile.type);
    const gained = ResourceSystem.gatherTile(tile, G.resources, G.season, bonus, gatherMultiplier);
    if (gained) {
      SoundSystem.play('gather');
      const parts = [];
      if (gained.food > 0) parts.push('+' + gained.food + ' 🌿');
      if (gained.wood > 0) parts.push('+' + gained.wood + ' 🌲');
      if (gained.stone > 0) parts.push('+' + gained.stone + ' 🪨');
      villager.lastResult = parts.join(' ');
      msgs.push({ text: `🧍 ${villager.name} gathered ${parts.join(' ')}`, type: 'good' });
    } else {
      villager.lastResult = 'Nothing left here';
    }
  }
  return msgs;
}

function maybeTriggerLastStand(tribeResult) {
  if (!G || G.runStats.lastStandUsed) return;
  if (G.tribe.population > 2) return;

  G.runStats.lastStandUsed = true;
  G.runStats.insaneMoments.push('Last Stand activated');
  G.runStats.comebackScore += 15;
  G.morale.morale = Math.min(100, G.morale.morale + 20);
  G.resources.food = Math.min(G.resources.maxFood, G.resources.food + 8);
  G.resources.wood = Math.min(G.resources.maxWood, G.resources.wood + 5);
  UISystem.toast('🔥 LAST STAND ACTIVATED', 2600);
  UISystem.logGather({ text: '🔥 Last Stand: the tribe rallied, scavenged supplies, and refused to die.', type: 'good' });
}

function updateRunStats(tribeResult) {
  G.runStats.maxPopulation = Math.max(G.runStats.maxPopulation, G.tribe.population);
  G.runStats.minPopulation = Math.min(G.runStats.minPopulation, G.tribe.population);
  if (G.tribe.population <= 2) G.runStats.nearDeathTurns++;
  G.runStats.populationRecovered = Math.max(G.runStats.populationRecovered, G.tribe.population - G.runStats.minPopulation);
  G.runStats.comebackScore = G.runStats.nearDeathTurns * 2 + (G.runStats.lastStandUsed ? 10 : 0) + G.runStats.populationRecovered;

  if (G.day >= 50 && !G.runStats.insaneMoments.includes('Reached Day 50')) {
    G.runStats.insaneMoments.push('Reached Day 50');
  }
  if (G.runStats.maxPopulation >= 20 && !G.runStats.insaneMoments.includes('Village surge')) {
    G.runStats.insaneMoments.push('Village surge');
  }
}

function processEra() {
  const thresholds = [0, 60, 150, 300];
  const names = ['Stone Age', 'Bronze Age', 'Iron Age', 'Classical Age'];
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (G.day >= thresholds[i] && G.era < i) {
      G.era = i;
      UISystem.logGather({ text: `🏛️ Era reached: ${names[i]}`, type: 'good' });
      UISystem.toast(`🏛️ New era: ${names[i]}!`, 3000);
      SoundSystem.play('era');
    }
  }
}

function onTileTap(tile) {
  if (!G) return;
  claimDiscoveryReward(tile);

  const def = WorldGen.TILE_DEFS[tile.type];
  if (currentMode === 'gather') handleAssignVillager(tile, def);
  else if (currentMode === 'build') handleBuild(tile, def);

  UISystem.updateInfoPanel(G.tribe, G.resources, G.buildings, G.morale, G.runStats, G.seed);
}

function claimDiscoveryReward(tile) {
  if (!tile?.special || tile.specialClaimed) return;
  tile.specialClaimed = true;
  G.runStats.specialFinds++;
  const label = WorldGen.SPECIALS[tile.special]?.name || 'Find';

  switch (tile.special) {
    case 'cache':
      G.resources.food = Math.min(G.resources.maxFood, G.resources.food + 10);
      G.resources.wood = Math.min(G.resources.maxWood, G.resources.wood + 6);
      UISystem.toast(`📦 ${label}: +10 food, +6 wood`);
      break;
    case 'shrine':
      G.morale.morale = Math.min(100, G.morale.morale + 15);
      UISystem.toast(`✨ ${label}: morale surged`);
      break;
    case 'ruins':
      G.resources.stone = Math.min(G.resources.maxStone, G.resources.stone + 12);
      UISystem.toast(`🏛️ ${label}: +12 stone`);
      break;
    case 'survivors':
      G.tribe.population += 2;
      UISystem.toast(`🧍 ${label}: 2 survivors joined`);
      syncVillagersToPopulation();
      break;
  }

  G.runStats.insaneMoments.push(label);
  UISystem.logGather({ text: `${WorldGen.SPECIALS[tile.special]?.emoji || '✨'} Discovered ${label}`, type: 'good' });
}

function handleAssignVillager(tile, def) {
  if (!def.passable) { UISystem.toast('Cannot send villagers there.'); return; }
  if (tile.buildingId) {
    const b = G.buildings.placed[tile.buildingId];
    const bDef = BuildingSystem.BUILDING_DEFS[b?.defId];
    UISystem.toast(`${bDef?.emoji || '🏗️'} ${bDef?.name} — ${bDef?.description}`);
    return;
  }

  const villager = getSelectedVillager();
  if (!villager) { UISystem.toast('Select a villager first.'); return; }

  villager.task = { type: 'gather', x: tile.x, y: tile.y };
  villager.lastResult = `Assigned to ${def.name}`;
  UISystem.toast(`🧍 ${villager.name} assigned to ${def.name}`);
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
  UISystem.revealAround(tile.x, tile.y, 2 + (BuildingSystem.getStrategySummary(G.buildings).revealRange || 0));
  SoundSystem.play('build');
  spawnParticlesBurst(tile, 'build');

  selectedBuildDef = null;
  updateHUDAndRender();
}

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
    autoSave();
    UISystem.toast('💾 Game saved!');
  });

  document.getElementById('btn-abandon').addEventListener('click', () => {
    if (confirm('Abandon this run?')) {
      SaveSystem.deleteSave();
      G = null;
      UISystem.showScreen('menu');
      document.getElementById('pause-menu').classList.add('hidden');
      document.getElementById('btn-continue').disabled = true;
    }
  });

  document.getElementById('btn-festival').addEventListener('click', () => {
    if (!G) return;
    const result = MoraleSystem.holdFestival(G.morale, G.resources);
    if (result.ok) {
      SoundSystem.play('festival');
      UISystem.toast('🎉 Festival! Morale boosted!');
      UISystem.logGather({ text: '🎉 The tribe celebrates!', type: 'good' });
      updateHUDAndRender();
    } else {
      UISystem.toast('❌ ' + result.reason);
    }
  });

  document.getElementById('btn-sound').addEventListener('click', () => {
    const nowEnabled = !SoundSystem.isEnabled();
    SoundSystem.setEnabled(nowEnabled);
    document.getElementById('btn-sound').textContent = nowEnabled ? '🔊' : '🔇';
  });

  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentMode = tab.dataset.mode;
      UISystem.setMode(currentMode);
      if (currentMode === 'build' && G) refreshBuildPanel();
      if (currentMode === 'info' && G) UISystem.updateInfoPanel(G.tribe, G.resources, G.buildings, G.morale, G.runStats, G.seed);
      if (currentMode === 'trade' && G) updateTradePanel();
      if (currentMode === 'achievements' && G) updateAchievementsPanel();
      if (currentMode === 'gather' && G) refreshGatherPanel();
    });
  });

  document.getElementById('btn-submit-score').addEventListener('click', submitLeaderboardScore);
}

function refreshGatherPanel() {
  if (!G) return;
  UISystem.updateGatherPanel(G.villagers, G.selectedVillagerId, villagerId => {
    G.selectedVillagerId = villagerId;
    refreshGatherPanel();
    UISystem.render();
  });
}

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
    const canDo = trade.give === 'morale' ? true : ResourceSystem.canAfford(G.resources, { [trade.give]: trade.giveAmt });
    const div = document.createElement('div');
    div.className = 'trade-card';
    div.innerHTML = `
      <span class="trade-label">${label}</span>
      <button class="btn btn-primary" ${canDo ? '' : 'disabled'}>TRADE</button>`;
    div.querySelector('button').addEventListener('click', () => {
      const res = MerchantSystem.executeTrade(G.merchant, trade.id, G.resources, G.morale, G);
      if (res.ok) {
        G.achievements._merchantTraded = true;
        G.runStats.merchantTrades++;
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

function updateAchievementsPanel() {
  const el = document.getElementById('achievements-content');
  if (!el || !G) return;
  const all = AchievementSystem.getAll(G.achievements.unlocked);
  el.innerHTML = '';
  const sorted = [...all.filter(a => a.unlocked), ...all.filter(a => !a.unlocked)];
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

function resizeParticleCanvas() {
  const pc = document.getElementById('particle-canvas');
  const vp = document.getElementById('map-viewport');
  if (!pc || !vp) return;
  pc.width = vp.clientWidth || window.innerWidth;
  pc.height = vp.clientHeight || 300;
}

function spawnParticlesBurst(tile, type) {
  const pc = document.getElementById('particle-canvas');
  if (!pc || !G) return;

  let cx = pc.width / 2;
  let cy = pc.height / 2;
  if (tile) {
    cx = pc.width / 2;
    cy = pc.height / 2;
  }

  const count = type === 'disaster' ? 34 : 18;
  const palette = type === 'disaster' ? ['#f39c12', '#e74c3c', '#ecf0f1'] : ['#e67e22', '#f1c40f', '#ecf0f1'];

  for (let i = 0; i < count; i++) {
    particles.push({
      x: cx,
      y: cy,
      vx: (Math.random() - 0.5) * (type === 'disaster' ? 7 : 4),
      vy: (Math.random() - 0.5) * (type === 'disaster' ? 7 : 4),
      life: 1,
      decay: 0.015 + Math.random() * 0.02,
      radius: 2 + Math.random() * 2.5,
      color: palette[Math.floor(Math.random() * palette.length)],
    });
  }

  if (!particleRAF) particleRAF = requestAnimationFrame(tickParticles);
}

function tickParticles() {
  const pc = document.getElementById('particle-canvas');
  if (!pc) return;
  const pctx = pc.getContext('2d');
  pctx.clearRect(0, 0, pc.width, pc.height);

  particles = particles.filter(p => p.life > 0);
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.12;
    p.life -= p.decay;
    pctx.globalAlpha = Math.max(0, p.life);
    pctx.fillStyle = p.color;
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

function submitLeaderboardScore() {
  const nameInput = document.getElementById('leaderboard-name-input');
  const name = (nameInput?.value || '').trim() || 'Survivor';
  const statusEl = document.getElementById('leaderboard-status');
  if (statusEl) statusEl.textContent = 'Submitting...';

  const stats = window._lastGameOverStats;
  if (!stats) return;

  LeaderboardSystem.submitScore(
    {
      name,
      days: stats.day,
      seed: stats.seed,
      era: stats.era,
      populationPeak: stats.populationPeak,
      comebackScore: stats.comebackScore,
      strategy: stats.strategy,
    },
    ({ ok, rank }) => {
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
    const sections = [
      { title: 'Longest Survival', data: [...scores].sort((a,b) => (b.days||0) - (a.days||0)).slice(0,5), metric: s => `${s.days || 0}d` },
      { title: 'Highest Population', data: [...scores].sort((a,b) => (b.populationPeak||0) - (a.populationPeak||0)).slice(0,5), metric: s => `${s.populationPeak || 0} pop` },
      { title: 'Best Comebacks', data: [...scores].sort((a,b) => (b.comebackScore||0) - (a.comebackScore||0)).slice(0,5), metric: s => `${s.comebackScore || 0} pts` },
    ];

    let any = false;
    sections.forEach(section => {
      const box = document.createElement('div');
      box.className = 'lb-section';
      box.innerHTML = `<div class="lb-section-title">${section.title}</div>`;
      if (!section.data.length) {
        box.innerHTML += '<p style="font-size:12px;color:var(--text-dim)">No scores yet.</p>';
      } else {
        section.data.forEach((s, i) => {
          any = true;
          const row = document.createElement('div');
          row.className = 'lb-row' + (highlightRank === i + 1 && section.title === 'Longest Survival' ? ' highlight' : '');
          row.innerHTML = `
            <span class="lb-rank">#${i+1}</span>
            <span class="lb-name">${s.name}</span>
            <span class="lb-days">${section.metric(s)}</span>
            <span style="font-size:10px;color:var(--text-dim);margin-left:4px">${ERA_NAMES[s.era] || ''}</span>`;
          box.appendChild(row);
        });
      }
      listEl.appendChild(box);
    });

    if (!any) {
      listEl.innerHTML = '<p style="font-size:12px;color:var(--text-dim)">No scores yet. Be the first!</p>';
    }
  });
}

function fullRender() {
  if (!G) return;
  const vp = document.getElementById('map-viewport');
  if (vp && vp.clientHeight > 0 && document.getElementById('game-canvas').height === 0) UISystem.recalcLayout();
  UISystem.render();
  UISystem.updateHUD(G.tribe, G.resources, G.day, G.year, G.season, G.era, G.morale, G.seed, G.runStats);
  UISystem.updateInfoPanel(G.tribe, G.resources, G.buildings, G.morale, G.runStats, G.seed);
  UISystem.updateEventBanner(EventSystem.getPendingWarning(G.events));
  updateMoraleHUD();
  if (currentMode === 'build') refreshBuildPanel();
  if (currentMode === 'trade') updateTradePanel();
  if (currentMode === 'achievements') updateAchievementsPanel();
  if (currentMode === 'gather') refreshGatherPanel();
}

function updateHUDAndRender() {
  if (!G) return;
  UISystem.render();
  UISystem.updateHUD(G.tribe, G.resources, G.day, G.year, G.season, G.era, G.morale, G.seed, G.runStats);
  UISystem.updateInfoPanel(G.tribe, G.resources, G.buildings, G.morale, G.runStats, G.seed);
  updateMoraleHUD();
  if (currentMode === 'build') refreshBuildPanel();
  if (currentMode === 'trade') updateTradePanel();
  if (currentMode === 'gather') refreshGatherPanel();
}

function updateMoraleHUD() {
  if (!G) return;
  const fill = document.getElementById('morale-bar-fill');
  if (!fill) return;
  const m = G.morale.morale;
  const color = m >= 60 ? '#2ecc71' : m >= 30 ? '#f39c12' : '#c0392b';
  fill.style.width = m + '%';
  fill.style.background = color;
  fill.title = MoraleSystem.getLabel(m) + ' · ' + (G.morale.lastEffects || '');
}

function refreshBuildPanel() {
  UISystem.updateBuildPanel(G.era, G.resources, selectedBuildDef, G.merchantBlueprints, defId => {
    selectedBuildDef = defId;
    UISystem.updateBuildPanel(G.era, G.resources, selectedBuildDef, G.merchantBlueprints, () => {});
  });
}

function autoSave() {
  if (!G) return;
  const ok = SaveSystem.save({
    seed: G.seed, day: G.day, year: G.year, season: G.season, era: G.era,
    tribe: G.tribe,
    resources: G.resources,
    worldTiles: G.world.tiles,
    buildings: G.buildings,
    events: G.events,
    eventLog: G.eventLog,
    exploredTiles: G.exploredTiles || [],
    growthAccumulator: TribeSystem.getAccumulator(),
    morale: G.morale,
    merchant: G.merchant,
    achievements: G.achievements,
    buildingsPlacedTotal: G.buildingsPlacedTotal,
    villagers: G.villagers,
    selectedVillagerId: G.selectedVillagerId,
    runStats: G.runStats,
    merchantBlueprints: G.merchantBlueprints,
  });
  const ind = document.getElementById('btn-autosave-indicator');
  if (ind) {
    ind.textContent = ok ? '💾' : '❌';
    setTimeout(() => { if (ind) ind.textContent = '💾'; }, 1500);
  }
  if (ok) document.getElementById('btn-continue').disabled = false;
}

function gameOver() {
  const strategy = BuildingSystem.getDominantStrategy(G.buildings);
  const stats = {
    day: G.day,
    year: G.year,
    season: G.season,
    era: G.era,
    seed: G.seed,
    tilesExplored: UISystem.getExploredCount(),
    buildingsPlaced: G.buildingsPlacedTotal,
    populationPeak: G.runStats.maxPopulation,
    specialFinds: G.runStats.specialFinds,
    cause: G.runStats.causeOfDeath || G.tribe.causeOfDeath || 'The mountain won.',
    strategy,
    comebackScore: G.runStats.comebackScore,
    insaneMoments: G.runStats.insaneMoments.slice(-4),
    epitaph: buildEpitaph(),
  };
  window._lastGameOverStats = stats;

  UISystem.showGameOver(stats);
  SaveSystem.deleteSave();
  document.getElementById('btn-continue').disabled = true;
  loadAndShowLeaderboard(null);
  G = null;
}

function buildEpitaph() {
  if (!G) return '';
  if (G.day >= 100) return 'You didn’t just survive. You became a mountain legend.';
  if (G.runStats.lastStandUsed) return 'This run should have been over. Somehow it wasn’t.';
  if (G.season === 3) return 'Winter finally got its due.';
  return 'The summit remembers every bad decision.';
}
