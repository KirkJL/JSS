/**
 * UI SYSTEM
 * ---------
 * Canvas rendering + HUD + panels.
 * Adds visible villagers, seed display, and stronger game-over screen.
 */
const UISystem = (() => {
  let canvas = null, ctx = null, mmCanvas = null, mmCtx = null;
  let world = null, gameState = null, onTileTap = null;

  let tileSize = 32;
  let offsetX = 0, offsetY = 0;
  let selectedTile = null;
  let exploredTiles = new Set();

  let isPanning = false, panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;
  const PAN_THRESHOLD = 8;
  const MM_TILE = 4;

  const TILE_COLORS = {
    PEAK: '#b0bec5',
    SNOW: '#ecf0f1',
    ROCK: '#78909c',
    FOREST: '#2e7d32',
    FERTILE: '#558b2f',
    WATER: '#1565c0',
    FLOODED: '#0d47a1',
    ASH: '#424242',
  };

  const TILE_DETAIL = {
    ROCK: '🪨',
    FOREST: '🌲',
    FERTILE: '🌿',
    SNOW: '❄️',
    WATER: '💧',
    ASH: '🔥',
  };

  const BUILDING_EMOJI = {
    SHELTER: '🏠',
    STORAGE: '🏚️',
    WATCHTOWER: '🗼',
    FARM: '🌾',
    FIREPIT: '🔥',
    LUMBER_CAMP: '🪓',
    QUARRY: '⛏️',
    SHRINE: '⛩️',
  };

  function init(c, onTap) {
    canvas = c;
    ctx = canvas.getContext('2d');
    onTileTap = onTap;

    mmCanvas = document.createElement('canvas');
    mmCanvas.id = 'mini-map';
    mmCanvas.style.cssText = 'position:absolute;right:8px;top:8px;background:#050810;pointer-events:none;z-index:10;opacity:.88;';
    document.getElementById('map-viewport').appendChild(mmCanvas);
    mmCtx = mmCanvas.getContext('2d');

    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('pointerup', onPointerUp, { passive: true });
    canvas.addEventListener('pointercancel', () => { isPanning = false; });
    canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  }

  function setWorld(w, gs) {
    world = w;
    gameState = gs;

    if (gs.exploredTiles && gs.exploredTiles.length) {
      exploredTiles = new Set(gs.exploredTiles);
    } else {
      exploredTiles = new Set();
      const start = WorldGen.findStartTile(w);
      revealAround(start.x, start.y, 2);
    }

    recalcLayout();
  }

  function recalcLayout() {
    if (!world) return;
    const vp = document.getElementById('map-viewport');
    const vpW = Math.max(vp.clientWidth, canvas.width) || window.innerWidth;
    const vpH = Math.max(vp.clientHeight, canvas.height) || Math.floor(window.innerHeight * 0.52);

    canvas.width = vpW;
    canvas.height = vpH;

    const tsW = Math.floor(vpW / world.width);
    const tsH = Math.floor(vpH / world.height);
    tileSize = Math.max(28, Math.min(tsW, tsH));
    offsetX = Math.floor((vpW - world.width * tileSize) / 2);
    offsetY = Math.floor((vpH - world.height * tileSize) / 2);

    if (mmCanvas && world) {
      mmCanvas.width = world.width * MM_TILE;
      mmCanvas.height = world.height * MM_TILE;
    }
  }

  function fogKey(x, y) { return x + ',' + y; }
  function isExplored(tile) { return exploredTiles.has(fogKey(tile.x, tile.y)); }

  function revealTile(tile) {
    if (!world) return false;
    const before = exploredTiles.size;
    exploredTiles.add(fogKey(tile.x, tile.y));
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = WorldGen.getTile(world, tile.x + dx, tile.y + dy);
        if (n) exploredTiles.add(fogKey(n.x, n.y));
      }
    }
    if (gameState) gameState.exploredTiles = Array.from(exploredTiles);
    return exploredTiles.size !== before;
  }

  function revealAround(cx, cy, radius) {
    if (!world) return;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const t = WorldGen.getTile(world, cx + dx, cy + dy);
        if (t) exploredTiles.add(fogKey(t.x, t.y));
      }
    }
    if (gameState) gameState.exploredTiles = Array.from(exploredTiles);
  }

  function render() {
    if (!world || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const tile of world.tiles) drawTile(tile);
    drawVillagers();
    if (selectedTile) drawSelection(selectedTile);
    drawMinimap();
  }

  function drawTile(tile) {
    const px = offsetX + tile.x * tileSize;
    const py = offsetY + tile.y * tileSize;
    const ts = tileSize - 1;

    if (px + ts < 0 || py + ts < 0 || px > canvas.width || py > canvas.height) return;

    if (!isExplored(tile)) {
      ctx.fillStyle = '#0a0c13';
      ctx.fillRect(px, py, ts, ts);
      ctx.fillStyle = 'rgba(255,255,255,.015)';
      ctx.fillRect(px, py, ts, 1);
      ctx.fillRect(px, py, 1, ts);
      return;
    }

    let color = TILE_COLORS[tile.type] || '#333';
    if (tile.depleted && !tile.buildingId) color = blendColor(color, '#111', 0.42);

    ctx.fillStyle = color;
    ctx.fillRect(px, py, ts, ts);

    const shade = (1 - tile.height) * 0.28;
    ctx.fillStyle = `rgba(0,0,0,${shade.toFixed(2)})`;
    ctx.fillRect(px, py, ts, ts);

    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(px, py, ts, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(px, py + ts - 2, ts, 2);

    let emoji = '';
    if (tile.buildingId) {
      const def = getBuildingDef(tile.buildingId);
      emoji = (def && BUILDING_EMOJI[def.id]) || '🏗️';
    } else if (tile.special && !tile.specialClaimed) {
      emoji = WorldGen.SPECIALS[tile.special]?.emoji || '✨';
    } else if (!tile.depleted) {
      emoji = TILE_DETAIL[tile.type] || '';
    }

    if (emoji && tileSize >= 32) {
      ctx.font = `${Math.floor(tileSize * 0.46)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, px + ts / 2, py + ts / 2);
    }

    if (tile.depleted && !tile.buildingId) {
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.beginPath();
      ctx.arc(px + ts - 5, py + 5, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawVillagers() {
    if (!gameState?.villagers?.length || !world) return;
    for (const villager of gameState.villagers) {
      const tile = WorldGen.getTile(world, villager.x, villager.y);
      if (!tile || !isExplored(tile)) continue;

      const px = offsetX + tile.x * tileSize + tileSize / 2;
      const py = offsetY + tile.y * tileSize + tileSize / 2 + tileSize * 0.15;
      const selected = villager.id === gameState.selectedVillagerId;

      ctx.beginPath();
      ctx.fillStyle = selected ? '#f1c40f' : '#f5cba7';
      ctx.arc(px, py, Math.max(4, tileSize * 0.12), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.65)';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (villager.task?.type === 'gather') {
        ctx.strokeStyle = 'rgba(46, 204, 113, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(7, tileSize * 0.2), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawSelection(tile) {
    const px = offsetX + tile.x * tileSize;
    const py = offsetY + tile.y * tileSize;
    const ts = tileSize - 1;
    ctx.strokeStyle = '#f39c12';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, ts - 2, ts - 2);
  }

  function drawMinimap() {
    if (!mmCtx || !world) return;
    mmCtx.clearRect(0, 0, mmCanvas.width, mmCanvas.height);

    for (const tile of world.tiles) {
      const mx = tile.x * MM_TILE;
      const my = tile.y * MM_TILE;
      if (!isExplored(tile)) {
        mmCtx.fillStyle = '#111318';
        mmCtx.fillRect(mx, my, MM_TILE - 1, MM_TILE - 1);
        continue;
      }
      mmCtx.fillStyle = tile.buildingId ? '#e67e22' : (TILE_COLORS[tile.type] || '#333');
      mmCtx.fillRect(mx, my, MM_TILE - 1, MM_TILE - 1);
    }

    const vL = (-offsetX / tileSize) * MM_TILE;
    const vT = (-offsetY / tileSize) * MM_TILE;
    const vW = (canvas.width / tileSize) * MM_TILE;
    const vH = (canvas.height / tileSize) * MM_TILE;
    mmCtx.strokeStyle = 'rgba(255,255,255,.55)';
    mmCtx.lineWidth = 1;
    mmCtx.strokeRect(vL, vT, vW, vH);
  }

  const SEASONS = ['🌱 Spring', '☀️ Summer', '🍂 Autumn', '❄️ Winter'];
  const ERAS = ['Stone Age', 'Bronze Age', 'Iron Age', 'Classical Age'];

  function updateHUD(tribe, resources, day, year, season, era, morale, seed, runStats) {
    setText('stat-pop', tribe.population);
    setText('stat-food', resources.food + '/' + resources.maxFood);
    setText('stat-wood', resources.wood + '/' + resources.maxWood);
    setText('stat-stone', resources.stone + '/' + resources.maxStone);
    setText('stat-day', 'D' + day);
    setText('season-label', SEASONS[season] + ' · Y' + year);
    setText('era-label', ERAS[era] || 'Ancient');
    setText('seed-label', 'Seed ' + seed);
    setText('objective-label', runStats?.objective || 'Reach Day 50');
  }

  function updateInfoPanel(tribe, resources, buildings, morale, runStats, seed) {
    const el = document.getElementById('info-content');
    if (!el) return;
    const fc = tribe.foodNeed < 25 ? 'bad' : tribe.foodNeed < 50 ? 'warn' : 'good';
    const wc = tribe.warmthNeed < 25 ? 'bad' : tribe.warmthNeed < 50 ? 'warn' : 'good';
    const sc = tribe.shelterNeed < 25 ? 'bad' : tribe.shelterNeed < 50 ? 'warn' : 'good';
    const shelterCap = BuildingSystem.getShelterCapacity(buildings);
    const strategy = BuildingSystem.getDominantStrategy(buildings);
    const gatherPct = Math.round((MoraleSystem.getGatherMultiplier(morale) - 1) * 100);
    const deathPct = Math.round((MoraleSystem.getDeathMultiplier(morale) - 1) * 100);

    el.innerHTML = `
      <div class="info-row"><span class="label">👥 Population</span><span class="value">${tribe.population}</span></div>
      <div class="info-row"><span class="label">🌱 Objective</span><span class="value">${runStats?.objective || 'Reach Day 50'}</span></div>
      <div class="info-row"><span class="label">🧠 Strategy</span><span class="value">${strategy}</span></div>
      <div class="needs-bar-wrap" style="margin:6px 0 10px">
        ${needsBar('🌿 Food', tribe.foodNeed, fc)}
        ${needsBar('🔥 Warmth', tribe.warmthNeed, wc)}
        ${needsBar('🏠 Shelter', tribe.shelterNeed, sc)}
      </div>
      <div class="info-row"><span class="label">Shelter slots</span><span class="value ${shelterCap>=tribe.population?'good':'bad'}">${shelterCap} / ${tribe.population}</span></div>
      <div class="info-row"><span class="label">Morale impact</span><span class="value">${gatherPct >= 0 ? '+' : ''}${gatherPct}% gather · ${deathPct >= 0 ? '+' : ''}${deathPct}% death mult</span></div>
      <div class="info-row"><span class="label">Spoilage / Burn</span><span class="value">${resources.spoiledLastTurn || 0} spoiled · ${resources.burnedWoodLastTurn || 0} burned</span></div>
      <div class="info-row"><span class="label">Map explored</span><span class="value">${exploredTiles.size}/${world ? world.tiles.length : '?'} tiles</span></div>
      <div class="info-row"><span class="label">Peak pop</span><span class="value">${runStats?.maxPopulation || tribe.population}</span></div>
      <div class="info-row"><span class="label">Seed</span><span class="value">${seed}</span></div>
    `;
  }

  function needsBar(label, val, cls) {
    const pct = Math.round(Math.max(0, Math.min(100, val)));
    const color = cls === 'good' ? '#2ecc71' : cls === 'warn' ? '#f39c12' : '#c0392b';
    return `<div class="needs-bar">
      <span class="needs-bar-label">${label}</span>
      <div class="needs-bar-track"><div class="needs-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span style="font-size:10px;color:var(--text-dim);font-family:var(--font-mono);width:28px;text-align:right">${pct}%</span>
    </div>`;
  }

  function updateGatherPanel(villagers, selectedVillagerId, onSelect) {
    const el = document.getElementById('panel-gather');
    if (!el) return;
    let list = document.getElementById('villager-list');
    let log = document.getElementById('gather-log');
    if (!list || !log) {
      el.innerHTML = `<p class="panel-hint">Select a villager, then tap a tile to assign gathering.</p><div id="villager-list" class="villager-list"></div><div id="gather-log"></div>`;
      list = document.getElementById('villager-list');
      log = document.getElementById('gather-log');
    }
    list.innerHTML = '';
    for (const villager of villagers) {
      const card = document.createElement('button');
      card.className = 'villager-card' + (villager.id === selectedVillagerId ? ' selected' : '');
      card.innerHTML = `
        <span class="villager-name">🧍 ${villager.name}</span>
        <span class="villager-task">${villager.lastResult || 'Idle'}</span>`;
      card.addEventListener('click', () => onSelect(villager.id));
      list.appendChild(card);
    }
  }

  function updateBuildPanel(era, resources, selectedBuildDef, merchantBlueprints, onSelect) {
    const el = document.getElementById('build-options');
    if (!el) return;
    el.innerHTML = '';
    const available = BuildingSystem.getAvailableBuildings(era, resources)
      .filter(def => !def.blueprintOnly || (merchantBlueprints || []).includes(def.id));

    for (const def of available) {
      const card = document.createElement('div');
      card.className = 'build-card' + (def.id === selectedBuildDef ? ' selected' : '') + (!def.affordable ? ' cant-afford' : '');
      const costStr = Object.entries(def.cost).map(([r, a]) => a + r[0].toUpperCase()).join(' ');
      card.innerHTML = `
        <div class="build-card-name">${def.emoji} ${def.name}</div>
        <div class="build-card-role">${def.role || 'utility'} build</div>
        <div class="build-card-cost" style="color:var(--text-dim);margin:2px 0">${def.description}</div>
        <div class="build-card-cost" style="color:var(--accent)">${def.strategyText || ''}</div>
        <div class="build-card-cost" style="color:var(--snow);margin-top:4px">Cost: ${costStr}</div>`;
      card.addEventListener('click', () => { if (def.affordable) onSelect(def.id); });
      el.appendChild(card);
    }
    if (!available.length) el.innerHTML = '<p class="panel-hint">No buildings available.</p>';
  }

  function updateEventBanner(pendingWarning) {
    const banner = document.getElementById('event-banner');
    if (!banner) return;
    if (!pendingWarning) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden');
    setText('event-icon', pendingWarning.emoji);
    setText('event-text', pendingWarning.text);
  }

  function logGather(msg) {
    let log = document.getElementById('gather-log');
    if (!log) return;
    const el = document.createElement('div');
    el.className = 'gather-entry';
    el.textContent = typeof msg === 'object' ? msg.text : msg;
    log.prepend(el);
    while (log.children.length > 10) log.lastChild.remove();
  }

  function toast(msg, duration = 2000) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  function showGameOver(stats) {
    const el = document.getElementById('gameover-stats');
    el.innerHTML = `
      <div class="stat-row"><span class="label">Survival Time</span><span class="value">${stats.day} days · Y${stats.year}</span></div>
      <div class="stat-row"><span class="label">Cause</span><span class="value">${stats.cause}</span></div>
      <div class="stat-row"><span class="label">Era Reached</span><span class="value">${ERAS[stats.era] || 'Ancient'}</span></div>
      <div class="stat-row"><span class="label">Mountain Seed</span><span class="value">${stats.seed}</span></div>
      <div class="stat-row"><span class="label">Peak Population</span><span class="value">${stats.populationPeak}</span></div>
      <div class="stat-row"><span class="label">Tiles Explored</span><span class="value">${stats.tilesExplored}</span></div>
      <div class="stat-row"><span class="label">Buildings Placed</span><span class="value">${stats.buildingsPlaced}</span></div>
      <div class="stat-row"><span class="label">Special Finds</span><span class="value">${stats.specialFinds}</span></div>
      <div class="stat-row"><span class="label">Comeback Score</span><span class="value">${stats.comebackScore}</span></div>
      <div class="stat-row"><span class="label">Strategy</span><span class="value">${stats.strategy}</span></div>
      <div class="epitaph-box">${stats.epitaph}</div>
      <div class="insane-box">${(stats.insaneMoments || []).map(m => `<span class="insane-pill">${m}</span>`).join('')}</div>
    `;
    showScreen('gameover');
  }

  function onPointerDown(e) {
    e.preventDefault();
    isPanning = false;
    panStartX = e.clientX; panStartY = e.clientY;
    panOriginX = offsetX; panOriginY = offsetY;
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (e.buttons === 0) return;
    const dx = e.clientX - panStartX, dy = e.clientY - panStartY;
    if (!isPanning && (Math.abs(dx) > PAN_THRESHOLD || Math.abs(dy) > PAN_THRESHOLD)) isPanning = true;
    if (isPanning) {
      offsetX = panOriginX + dx;
      offsetY = panOriginY + dy;
      clampOffset();
      render();
    }
  }

  function onPointerUp(e) {
    if (isPanning) { isPanning = false; return; }
    const rect = canvas.getBoundingClientRect();
    const tileX = Math.floor((e.clientX - rect.left - offsetX) / tileSize);
    const tileY = Math.floor((e.clientY - rect.top - offsetY) / tileSize);
    const tile = world ? WorldGen.getTile(world, tileX, tileY) : null;
    if (tile) {
      selectedTile = tile;
      revealTile(tile);
      render();
      if (onTileTap) onTileTap(tile);
    }
  }

  function clampOffset() {
    if (!world) return;
    const minX = canvas.width - world.width * tileSize - 40;
    const minY = canvas.height - world.height * tileSize - 40;
    offsetX = Math.max(minX, Math.min(40, offsetX));
    offsetY = Math.max(minY, Math.min(40, offsetY));
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const t = document.getElementById('screen-' + id);
    if (t) t.classList.add('active');
  }

  function setMode(mode) {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    document.querySelectorAll('.mode-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + mode));
  }

  function getBuildingDef(id) {
    if (!gameState?.buildings) return null;
    const b = gameState.buildings.placed[id];
    return b ? BuildingSystem.BUILDING_DEFS[b.defId] : null;
  }

  function blendColor(a, b, t) {
    const [r1, g1, bl1] = hexToRgb(a), [r2, g2, bl2] = hexToRgb(b);
    return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(bl1 + (bl2 - bl1) * t)})`;
  }
  function hexToRgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function setText(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }
  function clearSelectedTile() { selectedTile = null; render(); }

  return {
    init, setWorld, recalcLayout, render,
    updateHUD, updateInfoPanel, updateBuildPanel, updateGatherPanel, updateEventBanner,
    logGather, toast, showGameOver, showScreen, setMode,
    clearSelectedTile, revealTile, revealAround,
    getExploredCount: () => exploredTiles.size,
    getSelectedTile: () => selectedTile,
  };
})();
