/**
 * UI SYSTEM
 * ---------
 * Handles all rendering: canvas map drawing + DOM HUD updates.
 * Keeps rendering and game logic completely separated.
 *
 * Rendering approach:
 *   - Canvas: map tiles, buildings, selection highlight
 *   - DOM: HUD stats, panels, modals (small and infrequently changed)
 *
 * Touch/mouse input is captured here and dispatched to the game.
 *
 * To extend:
 *   - Add tile animations (water ripple, fire flicker) via canvas
 *   - Add fog-of-war overlay
 *   - Add minimap in corner
 */

const UISystem = (() => {

  // ---- Tile colour palette (drawn on canvas, no emoji for perf) ----
  const TILE_COLORS = {
    PEAK:    '#90a4ae',
    SNOW:    '#e8eaf6',
    ROCK:    '#607d8b',
    FOREST:  '#2e7d32',
    FERTILE: '#558b2f',
    WATER:   '#1565c0',
    FLOODED: '#0d47a1',
    ASH:     '#424242',
  };

  // Subtle patterns to differentiate tiles
  const TILE_DETAIL = {
    PEAK:    '·',
    SNOW:    '·',
    ROCK:    '·',
    FOREST:  '🌲',
    FERTILE: '🌿',
    WATER:   '💧',
    FLOODED: '🌊',
    ASH:     '💀',
  };

  const BUILDING_EMOJI = {
    SHELTER:    '🏠',
    STORAGE:    '🏚️',
    WATCHTOWER: '🗼',
    FARM:       '🌾',
    FIREPIT:    '🔥',
  };

  // State
  let canvas, ctx;
  let tileSize = 40;
  let offsetX = 0, offsetY = 0;
  let world = null;
  let selectedTile = null;
  let gameState = null;  // reference to main game state (read-only here)
  let onTileTap = null;  // callback: (tile) => void

  // Touch panning
  let isPanning = false;
  let panStartX, panStartY, panOriginX, panOriginY;
  let lastTapX, lastTapY, lastTapTime = 0;
  const PAN_THRESHOLD = 6; // px movement before it counts as a pan

  /** Initialize canvas and bind input events. */
  function init(canvasEl, tapCallback) {
    canvas    = canvasEl;
    ctx       = canvas.getContext('2d');
    onTileTap = tapCallback;

    // Pointer events (handles both touch and mouse)
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: true  });
    canvas.addEventListener('pointerup',   onPointerUp,   { passive: true  });
    canvas.addEventListener('pointercancel', () => { isPanning = false; });

    // Prevent default scroll
    canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  }

  /** Set the world reference and recalculate tile size + initial offset. */
  function setWorld(w, gs) {
    world = w;
    gameState = gs;
    recalcLayout();
  }

  /** Recalculate tile size to fit the map viewport. */
  function recalcLayout() {
    if (!world) return;
    const vp   = document.getElementById('map-viewport');
    const vpW  = vp.clientWidth;
    const vpH  = vp.clientHeight;

    canvas.width  = vpW;
    canvas.height = vpH;

    // Tile size: fit map width OR height, whichever is the tighter constraint
    const tsW = Math.floor(vpW / world.width);
    const tsH = Math.floor(vpH / world.height);
    tileSize = Math.max(28, Math.min(56, Math.min(tsW, tsH)));

    // Centre the map initially
    offsetX = Math.floor((vpW - world.width  * tileSize) / 2);
    offsetY = Math.floor((vpH - world.height * tileSize) / 2);
  }

  // =============================================
  // CANVAS RENDERING
  // =============================================

  /** Full redraw — call once per game tick (not every animation frame). */
  function render() {
    if (!world || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background (void around the mountain)
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw tiles
    for (const tile of world.tiles) {
      drawTile(tile);
    }

    // Draw selected tile highlight
    if (selectedTile) {
      drawSelection(selectedTile);
    }
  }

  function drawTile(tile) {
    const px = offsetX + tile.x * tileSize;
    const py = offsetY + tile.y * tileSize;
    const ts = tileSize - 1; // 1px gap between tiles

    // Cull off-screen
    if (px + ts < 0 || py + ts < 0 || px > canvas.width || py > canvas.height) return;

    // Base colour
    let color = TILE_COLORS[tile.type] || '#333';

    // Dim depleted tiles
    if (tile.depleted && !tile.buildingId) {
      color = blendColor(color, '#111', .45);
    }

    ctx.fillStyle = color;
    ctx.fillRect(px, py, ts, ts);

    // Subtle inner shadow for depth
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(px, py + ts - 3, ts, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(px, py, ts, 2);

    // Emoji icons (only if tile is large enough)
    if (tileSize >= 36) {
      const emoji = tile.buildingId
        ? BUILDING_EMOJI[getBuildingDef(tile.buildingId)?.id] || '🏗️'
        : (tile.depleted ? '' : TILE_DETAIL[tile.type] || '');

      if (emoji) {
        const fontSize = Math.floor(tileSize * .48);
        ctx.font = `${fontSize}px serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, px + ts / 2, py + ts / 2);
      }
    }

    // Small dot if depleted but with no building
    if (tile.depleted && !tile.buildingId && tileSize >= 32) {
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.beginPath();
      ctx.arc(px + ts - 6, py + 6, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSelection(tile) {
    const px = offsetX + tile.x * tileSize;
    const py = offsetY + tile.y * tileSize;
    const ts = tileSize - 1;

    ctx.strokeStyle = '#e67e22';
    ctx.lineWidth   = 2;
    ctx.strokeRect(px + 1, py + 1, ts - 2, ts - 2);

    // Animated pulse (cheap: just redraw every render frame)
    ctx.strokeStyle = 'rgba(230,126,34,.3)';
    ctx.lineWidth   = 4;
    ctx.strokeRect(px - 1, py - 1, ts + 2, ts + 2);
  }

  function getBuildingDef(buildingId) {
    if (!gameState || !gameState.buildings) return null;
    const b = gameState.buildings.placed[buildingId];
    if (!b) return null;
    return BuildingSystem.BUILDING_DEFS[b.defId];
  }

  /** Blend two hex colors. t=0 → a, t=1 → b */
  function blendColor(hexA, hexB, t) {
    const [r1,g1,b1] = hexToRgb(hexA);
    const [r2,g2,b2] = hexToRgb(hexB);
    const r = Math.round(r1 + (r2-r1)*t);
    const g = Math.round(g1 + (g2-g1)*t);
    const b = Math.round(b1 + (b2-b1)*t);
    return `rgb(${r},${g},${b})`;
  }
  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#',''), 16);
    return [(n>>16)&255, (n>>8)&255, n&255];
  }

  // =============================================
  // DOM HUD UPDATES
  // =============================================

  const SEASONS = ['🌱 Spring', '☀️ Summer', '🍂 Autumn', '❄️ Winter'];
  const ERAS    = ['Stone Age', 'Bronze Age', 'Iron Age', 'Classical Age'];

  /** Update top HUD stats. */
  function updateHUD(tribe, resources, day, year, season, era) {
    setText('stat-pop',   tribe.population);
    setText('stat-food',  `${resources.food}/${resources.maxFood}`);
    setText('stat-wood',  `${resources.wood}/${resources.maxWood}`);
    setText('stat-stone', `${resources.stone}/${resources.maxStone}`);
    setText('stat-day',   `D${day}`);
    setText('season-label', `${SEASONS[season]} · Y${year}`);
    setText('era-label',    ERAS[era] || 'Ancient');
  }

  /** Update the Info panel with tribe status. */
  function updateInfoPanel(tribe, resources, buildings) {
    const el = document.getElementById('info-content');
    if (!el) return;

    const foodClass  = tribe.foodNeed  < 25 ? 'bad' : tribe.foodNeed  < 50 ? 'warn' : 'good';
    const warmClass  = tribe.warmthNeed< 25 ? 'bad' : tribe.warmthNeed< 50 ? 'warn' : 'good';
    const sheltClass = tribe.shelterNeed<25  ? 'bad' : tribe.shelterNeed<50 ? 'warn' : 'good';

    el.innerHTML = `
      <div class="info-row"><span class="label">Population</span><span class="value">${tribe.population}</span></div>
      <div class="needs-bar-wrap">
        ${needsBar('🌿 Food',    tribe.foodNeed,    foodClass)}
        ${needsBar('🔥 Warmth',  tribe.warmthNeed,  warmClass)}
        ${needsBar('🏠 Shelter', tribe.shelterNeed, sheltClass)}
      </div>
      <div class="info-row"><span class="label">Shelter cap</span><span class="value">${BuildingSystem.getShelterCapacity(buildings)} / ${tribe.population}</span></div>
      <div class="info-row"><span class="label">Food/turn</span><span class="value text-warn">−${Math.ceil(tribe.population * .5)}</span></div>
    `;
  }

  function needsBar(label, val, cls) {
    const pct = Math.round(val);
    const color = cls === 'good' ? '#2ecc71' : cls === 'warn' ? '#f39c12' : '#c0392b';
    return `
      <div class="needs-bar">
        <span class="needs-bar-label">${label}</span>
        <div class="needs-bar-track">
          <div class="needs-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span style="font-size:10px;color:var(--text-dim);font-family:var(--font-mono);width:28px;text-align:right">${pct}%</span>
      </div>`;
  }

  /** Update the Build panel with available buildings. */
  function updateBuildPanel(era, resources, selectedBuildDef, onSelect) {
    const el = document.getElementById('build-options');
    if (!el) return;
    el.innerHTML = '';

    const available = BuildingSystem.getAvailableBuildings(era, resources);

    for (const def of available) {
      const card = document.createElement('div');
      card.className = 'build-card' +
        (def.id === selectedBuildDef ? ' selected' : '') +
        (!def.affordable ? ' cant-afford' : '');

      const costStr = Object.entries(def.cost)
        .map(([r, a]) => `${a}${r[0].toUpperCase()}`)
        .join(' ');

      card.innerHTML = `
        <div class="build-card-name">${def.emoji} ${def.name}</div>
        <div class="build-card-cost">Cost: ${costStr}</div>`;

      card.addEventListener('click', () => {
        if (def.affordable) onSelect(def.id);
      });

      el.appendChild(card);
    }

    if (available.length === 0) {
      el.innerHTML = '<p class="panel-hint">No buildings available yet.</p>';
    }
  }

  /** Show/hide/update the event warning banner. */
  function updateEventBanner(pendingWarning) {
    const banner = document.getElementById('event-banner');
    if (!pendingWarning) {
      banner.classList.add('hidden');
      return;
    }
    banner.classList.remove('hidden');
    setText('event-icon', pendingWarning.emoji);
    setText('event-text', pendingWarning.text);
  }

  /** Append a line to the gather log. */
  function logGather(msg) {
    const log = document.getElementById('gather-log');
    if (!log) return;
    const el = document.createElement('div');
    el.className = 'gather-entry';
    el.textContent = msg;
    log.prepend(el);
    // Keep max 8 entries
    while (log.children.length > 8) log.lastChild.remove();
  }

  /** Show a floating toast. */
  function toast(msg, duration = 2000) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  /** Show game over screen with stats. */
  function showGameOver(stats) {
    const el = document.getElementById('gameover-stats');
    el.innerHTML = `
      <div class="stat-row"><span class="label">Survival Time</span><span class="value">${stats.day} days · Y${stats.year}</span></div>
      <div class="stat-row"><span class="label">Season</span><span class="value">${SEASONS[stats.season]}</span></div>
      <div class="stat-row"><span class="label">Era Reached</span><span class="value">${ERAS[stats.era] || 'Ancient'}</span></div>
      <div class="stat-row"><span class="label">Mountain Seed</span><span class="value">${stats.seed}</span></div>
      <div class="stat-row"><span class="label">Buildings Placed</span><span class="value">${stats.buildingsPlaced}</span></div>
    `;
    showScreen('gameover');
  }

  // =============================================
  // INPUT HANDLING
  // =============================================

  function onPointerDown(e) {
    e.preventDefault();
    isPanning   = false;
    panStartX   = e.clientX;
    panStartY   = e.clientY;
    panOriginX  = offsetX;
    panOriginY  = offsetY;
    lastTapX    = e.clientX;
    lastTapY    = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (e.buttons === 0) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;

    if (!isPanning && (Math.abs(dx) > PAN_THRESHOLD || Math.abs(dy) > PAN_THRESHOLD)) {
      isPanning = true;
    }

    if (isPanning) {
      offsetX = panOriginX + dx;
      offsetY = panOriginY + dy;
      clampOffset();
      render();
    }
  }

  function onPointerUp(e) {
    if (isPanning) { isPanning = false; return; }

    // It's a tap — find which tile was hit
    const rect  = canvas.getBoundingClientRect();
    const cx    = e.clientX - rect.left;
    const cy    = e.clientY - rect.top;
    const tileX = Math.floor((cx - offsetX) / tileSize);
    const tileY = Math.floor((cy - offsetY) / tileSize);
    const tile  = world ? WorldGen.getTile(world, tileX, tileY) : null;

    if (tile) {
      selectedTile = tile;
      render();
      if (onTileTap) onTileTap(tile);
    }
  }

  /** Prevent panning outside the map bounds. */
  function clampOffset() {
    if (!world) return;
    const mapW = world.width  * tileSize;
    const mapH = world.height * tileSize;
    const vpW  = canvas.width;
    const vpH  = canvas.height;

    const minX = vpW - mapW - 40;
    const minY = vpH - mapH - 40;
    offsetX = Math.max(minX, Math.min(40, offsetX));
    offsetY = Math.max(minY, Math.min(40, offsetY));
  }

  // =============================================
  // SCREEN MANAGEMENT
  // =============================================

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('screen-' + id);
    if (target) target.classList.add('active');
  }

  function setMode(mode) {
    document.querySelectorAll('.mode-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.mode === mode));
    document.querySelectorAll('.mode-panel').forEach(p =>
      p.classList.toggle('active', p.id === 'panel-' + mode));
  }

  // ---- Helpers ----
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function clearSelectedTile() {
    selectedTile = null;
    render();
  }

  return {
    init,
    setWorld,
    recalcLayout,
    render,
    updateHUD,
    updateInfoPanel,
    updateBuildPanel,
    updateEventBanner,
    logGather,
    toast,
    showGameOver,
    showScreen,
    setMode,
    clearSelectedTile,
    getSelectedTile: () => selectedTile,
  };

})();
