/**
 * UI SYSTEM
 * ---------
 * NEW in this version:
 *   - Fog of War: unexplored tiles are dark. Tiles reveal when tapped or
 *     when a building is placed nearby. Starting area revealed at spawn.
 *   - Minimap: small canvas overlay bottom-right showing explored terrain.
 *   - People dots: small circles drawn near shelter buildings showing population.
 */

const UISystem = (() => {

  const TILE_COLORS = {
    PEAK:    '#90a4ae',
    SNOW:    '#dde3f0',
    ROCK:    '#607d8b',
    FOREST:  '#2e7d32',
    FERTILE: '#558b2f',
    WATER:   '#1565c0',
    FLOODED: '#0d47a1',
    ASH:     '#424242',
  };

  const TILE_DETAIL = {
    FOREST:  '🌲',
    FERTILE: '🌿',
    WATER:   '💧',
    FLOODED: '🌊',
    SNOW:    '❄️',
    ASH:     '💀',
  };

  const BUILDING_EMOJI = {
    SHELTER:    '🏠',
    STORAGE:    '🏚️',
    WATCHTOWER: '🗼',
    FARM:       '🌾',
    FIREPIT:    '🔥',
  };

  let canvas, ctx;
  let tileSize = 40;
  let offsetX = 0, offsetY = 0;
  let world = null;
  let selectedTile = null;
  let gameState = null;
  let onTileTap = null;

  // Fog of war — Set of "x,y" key strings
  let exploredTiles = new Set();

  // Minimap
  let mmCanvas = null, mmCtx = null;
  const MM_TILE = 4;
  const MM_PAD  = 8;

  // Touch
  let isPanning = false;
  let panStartX, panStartY, panOriginX, panOriginY;
  const PAN_THRESHOLD = 6;

  // ---- INIT ----

  function init(canvasEl, tapCallback) {
    canvas    = canvasEl;
    ctx       = canvas.getContext('2d');
    onTileTap = tapCallback;

    // Build minimap canvas and inject into map-viewport
    mmCanvas              = document.createElement('canvas');
    mmCanvas.id           = 'minimap-canvas';
    mmCanvas.style.cssText = `position:absolute;bottom:${MM_PAD}px;right:${MM_PAD}px;
      border:1px solid rgba(255,255,255,.2);border-radius:4px;background:#050810;
      pointer-events:none;z-index:10;opacity:.88;`;
    document.getElementById('map-viewport').appendChild(mmCanvas);
    mmCtx = mmCanvas.getContext('2d');

    canvas.addEventListener('pointerdown',  onPointerDown,  { passive: false });
    canvas.addEventListener('pointermove',  onPointerMove,  { passive: true  });
    canvas.addEventListener('pointerup',    onPointerUp,    { passive: true  });
    canvas.addEventListener('pointercancel', () => { isPanning = false; });
    canvas.addEventListener('touchstart',   e => e.preventDefault(), { passive: false });
  }

  function setWorld(w, gs) {
    world     = w;
    gameState = gs;

    if (gs.exploredTiles && gs.exploredTiles.length) {
      exploredTiles = new Set(gs.exploredTiles);
    } else {
      exploredTiles = new Set();
      // Reveal spawn area (2-tile radius from centre)
      revealAround(Math.floor(w.width / 2), Math.floor(w.height / 2), 2);
    }

    recalcLayout();
  }

  function recalcLayout() {
    if (!world) return;
    const vp  = document.getElementById('map-viewport');
    const vpW = Math.max(vp.clientWidth,  canvas.width)  || window.innerWidth;
    const vpH = Math.max(vp.clientHeight, canvas.height) || Math.floor(window.innerHeight * 0.52);

    canvas.width  = vpW;
    canvas.height = vpH;

    const tsW = Math.floor(vpW / world.width);
    const tsH = Math.floor(vpH / world.height);
    tileSize  = Math.max(28, Math.min(tsW, tsH));

    offsetX = Math.floor((vpW - world.width  * tileSize) / 2);
    offsetY = Math.floor((vpH - world.height * tileSize) / 2);

    if (mmCanvas && world) {
      mmCanvas.width  = world.width  * MM_TILE;
      mmCanvas.height = world.height * MM_TILE;
    }
  }

  // ---- FOG OF WAR ----

  function fogKey(x, y) { return x + ',' + y; }

  function isExplored(tile) { return exploredTiles.has(fogKey(tile.x, tile.y)); }

  function revealTile(tile) {
    if (!world) return;
    exploredTiles.add(fogKey(tile.x, tile.y));
    // Reveal all 8 neighbours too
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = WorldGen.getTile(world, tile.x + dx, tile.y + dy);
        if (n) exploredTiles.add(fogKey(n.x, n.y));
      }
    }
    if (gameState) gameState.exploredTiles = Array.from(exploredTiles);
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

  // ---- RENDERING ----

  function render() {
    if (!world || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const tile of world.tiles) drawTile(tile);
    drawPeople();
    if (selectedTile) drawSelection(selectedTile);
    drawMinimap();
  }

  function drawTile(tile) {
    const px = offsetX + tile.x * tileSize;
    const py = offsetY + tile.y * tileSize;
    const ts = tileSize - 1;

    if (px + ts < 0 || py + ts < 0 || px > canvas.width || py > canvas.height) return;

    if (!isExplored(tile)) {
      // Unexplored: nearly black with faint grid texture
      ctx.fillStyle = '#0a0c13';
      ctx.fillRect(px, py, ts, ts);
      ctx.fillStyle = 'rgba(255,255,255,.015)';
      ctx.fillRect(px, py, ts, 1);
      ctx.fillRect(px, py, 1, ts);
      return;
    }

    // Base terrain colour
    let color = TILE_COLORS[tile.type] || '#333';
    if (tile.depleted && !tile.buildingId) color = blendColor(color, '#111', .42);

    ctx.fillStyle = color;
    ctx.fillRect(px, py, ts, ts);

    // Height-based shading — lower altitude = slightly darker
    const shade = (1 - tile.height) * 0.28;
    ctx.fillStyle = `rgba(0,0,0,${shade.toFixed(2)})`;
    ctx.fillRect(px, py, ts, ts);

    // Highlights/shadows for depth
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(px, py, ts, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(px, py + ts - 2, ts, 2);

    // Emoji icon
    if (tileSize >= 32) {
      let emoji = '';
      if (tile.buildingId) {
        const def = getBuildingDef(tile.buildingId);
        emoji = (def && BUILDING_EMOJI[def.id]) || '🏗️';
      } else if (!tile.depleted) {
        emoji = TILE_DETAIL[tile.type] || '';
      }
      if (emoji) {
        ctx.font = `${Math.floor(tileSize * 0.46)}px serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, px + ts / 2, py + ts / 2);
      }
    }

    // Depleted dot
    if (tile.depleted && !tile.buildingId) {
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.beginPath();
      ctx.arc(px + ts - 5, py + 5, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Draw population as small warm-coloured dots clustered around shelter tiles.
   * Capped at 24 visible dots for performance. Positions are deterministic so
   * they don't flicker between renders.
   */
  function drawPeople() {
    if (!gameState || !world) return;
    const pop = gameState.tribe ? gameState.tribe.population : 0;
    if (pop <= 0) return;

    // Find anchor tiles: shelters first, else centre of explored passable area
    const anchors = [];
    for (const b of Object.values(gameState.buildings.placed)) {
      if (b.defId === 'SHELTER') {
        const t = WorldGen.getTile(world, b.tileX, b.tileY);
        if (t && isExplored(t)) anchors.push(t);
      }
    }
    if (anchors.length === 0) {
      const passable = world.tiles.filter(t => isExplored(t) && WorldGen.TILE_DEFS[t.type]?.passable);
      if (passable.length === 0) return;
      const cx = passable.reduce((s,t)=>s+t.x,0)/passable.length;
      const cy = passable.reduce((s,t)=>s+t.y,0)/passable.length;
      anchors.push(passable.reduce((b,t)=>
        Math.hypot(t.x-cx,t.y-cy) < Math.hypot(b.x-cx,b.y-cy) ? t : b));
    }

    const maxDots = Math.min(pop, 24);
    const r       = Math.max(2, tileSize * 0.09);
    const ts      = tileSize - 1;

    ctx.fillStyle   = '#f5cba7';
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth   = 0.8;

    for (let i = 0; i < maxDots; i++) {
      const anchor  = anchors[i % anchors.length];
      const px      = offsetX + anchor.x * tileSize;
      const py      = offsetY + anchor.y * tileSize;
      const angle   = (i / maxDots) * Math.PI * 2;
      const spread  = ts * 0.27;
      const dotX    = px + ts/2 + Math.cos(angle) * spread;
      const dotY    = py + ts/2 + Math.sin(angle) * spread;

      if (dotX < -r || dotY < -r || dotX > canvas.width+r || dotY > canvas.height+r) continue;

      ctx.beginPath();
      ctx.arc(dotX, dotY, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawSelection(tile) {
    const px = offsetX + tile.x * tileSize;
    const py = offsetY + tile.y * tileSize;
    const ts = tileSize - 1;
    ctx.strokeStyle = '#e67e22';
    ctx.lineWidth   = 2;
    ctx.strokeRect(px + 1, py + 1, ts - 2, ts - 2);
    ctx.strokeStyle = 'rgba(230,126,34,.25)';
    ctx.lineWidth   = 5;
    ctx.strokeRect(px - 1, py - 1, ts + 2, ts + 2);
  }

  function drawMinimap() {
    if (!mmCanvas || !world) return;
    mmCtx.clearRect(0, 0, mmCanvas.width, mmCanvas.height);
    mmCtx.fillStyle = '#050810';
    mmCtx.fillRect(0, 0, mmCanvas.width, mmCanvas.height);

    for (const tile of world.tiles) {
      const mx = tile.x * MM_TILE;
      const my = tile.y * MM_TILE;
      if (!isExplored(tile)) {
        mmCtx.fillStyle = '#111318';
        mmCtx.fillRect(mx, my, MM_TILE-1, MM_TILE-1);
        continue;
      }
      mmCtx.fillStyle = tile.buildingId ? '#e67e22' : (TILE_COLORS[tile.type] || '#333');
      mmCtx.fillRect(mx, my, MM_TILE-1, MM_TILE-1);
    }

    // Viewport box
    const vL = (-offsetX / tileSize) * MM_TILE;
    const vT = (-offsetY / tileSize) * MM_TILE;
    const vW = (canvas.width  / tileSize) * MM_TILE;
    const vH = (canvas.height / tileSize) * MM_TILE;
    mmCtx.strokeStyle = 'rgba(255,255,255,.55)';
    mmCtx.lineWidth   = 1;
    mmCtx.strokeRect(vL, vT, vW, vH);
  }

  // ---- DOM HUD ----

  const SEASONS = ['🌱 Spring', '☀️ Summer', '🍂 Autumn', '❄️ Winter'];
  const ERAS    = ['Stone Age', 'Bronze Age', 'Iron Age', 'Classical Age'];

  function updateHUD(tribe, resources, day, year, season, era, morale) {
    setText('stat-pop',   tribe.population);
    setText('stat-food',  resources.food + '/' + resources.maxFood);
    setText('stat-wood',  resources.wood + '/' + resources.maxWood);
    setText('stat-stone', resources.stone + '/' + resources.maxStone);
    setText('stat-day',   'D' + day);
    setText('season-label', SEASONS[season] + ' · Y' + year);
    setText('era-label',    ERAS[era] || 'Ancient');
  }

  function updateInfoPanel(tribe, resources, buildings) {
    const el = document.getElementById('info-content');
    if (!el) return;
    const fc = tribe.foodNeed   < 25 ? 'bad' : tribe.foodNeed   < 50 ? 'warn' : 'good';
    const wc = tribe.warmthNeed < 25 ? 'bad' : tribe.warmthNeed < 50 ? 'warn' : 'good';
    const sc = tribe.shelterNeed< 25 ? 'bad' : tribe.shelterNeed< 50 ? 'warn' : 'good';
    const shelterCap = BuildingSystem.getShelterCapacity(buildings);
    el.innerHTML = `
      <div class="info-row"><span class="label">👥 Population</span><span class="value">${tribe.population}</span></div>
      <div class="needs-bar-wrap" style="margin:6px 0 10px">
        ${needsBar('🌿 Food', tribe.foodNeed, fc)}
        ${needsBar('🔥 Warmth', tribe.warmthNeed, wc)}
        ${needsBar('🏠 Shelter', tribe.shelterNeed, sc)}
      </div>
      <div class="info-row"><span class="label">Shelter slots</span><span class="value ${shelterCap>=tribe.population?'good':'bad'}">${shelterCap} / ${tribe.population}</span></div>
      <div class="info-row"><span class="label">Food/turn consumed</span><span class="value text-warn">−${Math.ceil(tribe.population*.5)}</span></div>
      <div class="info-row"><span class="label">Map explored</span><span class="value">${exploredTiles.size}/${world?world.tiles.length:'?'} tiles</span></div>
    `;
  }

  function needsBar(label, val, cls) {
    const pct   = Math.round(Math.max(0, Math.min(100, val)));
    const color = cls==='good'?'#2ecc71':cls==='warn'?'#f39c12':'#c0392b';
    return `<div class="needs-bar">
      <span class="needs-bar-label">${label}</span>
      <div class="needs-bar-track"><div class="needs-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span style="font-size:10px;color:var(--text-dim);font-family:var(--font-mono);width:28px;text-align:right">${pct}%</span>
    </div>`;
  }

  function updateBuildPanel(era, resources, selectedBuildDef, onSelect) {
    const el = document.getElementById('build-options');
    if (!el) return;
    el.innerHTML = '';
    const available = BuildingSystem.getAvailableBuildings(era, resources);
    for (const def of available) {
      const card = document.createElement('div');
      card.className = 'build-card' +
        (def.id===selectedBuildDef?' selected':'') +
        (!def.affordable?' cant-afford':'');
      const costStr = Object.entries(def.cost).map(([r,a])=>a+r[0].toUpperCase()).join(' ');
      card.innerHTML = `
        <div class="build-card-name">${def.emoji} ${def.name}</div>
        <div class="build-card-cost" style="color:var(--text-dim);margin:2px 0">${def.description}</div>
        <div class="build-card-cost" style="color:var(--accent)">Cost: ${costStr}</div>`;
      card.addEventListener('click', () => { if (def.affordable) onSelect(def.id); });
      el.appendChild(card);
    }
    if (!available.length) el.innerHTML = '<p class="panel-hint">No buildings available.</p>';
  }

  function updateEventBanner(pendingWarning) {
    const banner = document.getElementById('event-banner');
    if (!pendingWarning) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden');
    setText('event-icon', pendingWarning.emoji);
    setText('event-text', pendingWarning.text);
  }

  function logGather(msg) {
    const log = document.getElementById('gather-log');
    if (!log) return;
    const el = document.createElement('div');
    el.className = 'gather-entry';
    el.textContent = typeof msg==='object' ? msg.text : msg;
    log.prepend(el);
    while (log.children.length > 10) log.lastChild.remove();
  }

  function toast(msg, duration=2000) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  function showGameOver(stats) {
    setText('gameover-stats', '');
    const el = document.getElementById('gameover-stats');
    el.innerHTML = `
      <div class="stat-row"><span class="label">Survival Time</span><span class="value">${stats.day} days · Y${stats.year}</span></div>
      <div class="stat-row"><span class="label">Season</span><span class="value">${SEASONS[stats.season]}</span></div>
      <div class="stat-row"><span class="label">Era Reached</span><span class="value">${ERAS[stats.era]||'Ancient'}</span></div>
      <div class="stat-row"><span class="label">Mountain Seed</span><span class="value">${stats.seed}</span></div>
      <div class="stat-row"><span class="label">Tiles Explored</span><span class="value">${stats.tilesExplored}</span></div>
      <div class="stat-row"><span class="label">Buildings Placed</span><span class="value">${stats.buildingsPlaced}</span></div>
    `;
    showScreen('gameover');
  }

  // ---- INPUT ----

  function onPointerDown(e) {
    e.preventDefault();
    isPanning  = false;
    panStartX  = e.clientX; panStartY = e.clientY;
    panOriginX = offsetX;   panOriginY = offsetY;
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (e.buttons===0) return;
    const dx = e.clientX - panStartX, dy = e.clientY - panStartY;
    if (!isPanning && (Math.abs(dx)>PAN_THRESHOLD||Math.abs(dy)>PAN_THRESHOLD)) isPanning=true;
    if (isPanning) { offsetX=panOriginX+dx; offsetY=panOriginY+dy; clampOffset(); render(); }
  }

  function onPointerUp(e) {
    if (isPanning) { isPanning=false; return; }
    const rect  = canvas.getBoundingClientRect();
    const tileX = Math.floor((e.clientX - rect.left - offsetX) / tileSize);
    const tileY = Math.floor((e.clientY - rect.top  - offsetY) / tileSize);
    const tile  = world ? WorldGen.getTile(world, tileX, tileY) : null;
    if (tile) {
      selectedTile = tile;
      revealTile(tile);
      render();
      if (onTileTap) onTileTap(tile);
    }
  }

  function clampOffset() {
    if (!world) return;
    const minX = canvas.width  - world.width  * tileSize - 40;
    const minY = canvas.height - world.height * tileSize - 40;
    offsetX = Math.max(minX, Math.min(40, offsetX));
    offsetY = Math.max(minY, Math.min(40, offsetY));
  }

  // ---- SCREEN / MODE ----

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    const t = document.getElementById('screen-'+id);
    if (t) t.classList.add('active');
  }

  function setMode(mode) {
    document.querySelectorAll('.mode-tab').forEach(t=>t.classList.toggle('active',t.dataset.mode===mode));
    document.querySelectorAll('.mode-panel').forEach(p=>p.classList.toggle('active',p.id==='panel-'+mode));
  }

  // ---- HELPERS ----

  function getBuildingDef(id) {
    if (!gameState?.buildings) return null;
    const b = gameState.buildings.placed[id];
    return b ? BuildingSystem.BUILDING_DEFS[b.defId] : null;
  }
  function blendColor(a, b, t) {
    const [r1,g1,bl1]=hexToRgb(a),[r2,g2,bl2]=hexToRgb(b);
    return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(bl1+(bl2-bl1)*t)})`;
  }
  function hexToRgb(hex) { const n=parseInt(hex.replace('#',''),16); return [(n>>16)&255,(n>>8)&255,n&255]; }
  function setText(id,val) { const e=document.getElementById(id); if(e) e.textContent=val; }
  function clearSelectedTile() { selectedTile=null; render(); }

  return {
    init, setWorld, recalcLayout, render,
    updateHUD, updateInfoPanel, updateBuildPanel, updateEventBanner,
    logGather, toast, showGameOver, showScreen, setMode,
    clearSelectedTile, revealTile, revealAround,
    getExploredCount: () => exploredTiles.size,
    getSelectedTile: () => selectedTile,
  };

})();
