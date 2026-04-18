/**
 * SAVE SYSTEM
 * -----------
 * Versioned save format with checksum, backup rotation, migration,
 * and explicit support for added late-game systems.
 */
const SaveSystem = (() => {
  const SAVE_KEY = 'peak_survivors_save_v2';
  const BACKUP_KEY = 'peak_survivors_save_v2_bak';
  const LEGACY_SAVE_KEYS = ['peak_survivors_save_v1', 'peak_survivors_save_v1_bak'];

  const SAVE_SCHEMA = {
    version: 'number',
    checksum: 'string',
    seed: 'string',
    day: 'number',
    year: 'number',
    season: 'number',
    era: 'number',
    tribe: 'object',
    resources: 'object',
    worldTiles: 'object',
    buildings: 'object',
  };

  const CURRENT_VERSION = 2;

  function serialize(state) {
    const raw = {
      version: CURRENT_VERSION,
      seed: String(state.seed),
      day: state.day,
      year: state.year,
      season: state.season,
      era: state.era,
      tribe: {
        population: state.tribe.population,
        foodNeed: state.tribe.foodNeed,
        shelterNeed: state.tribe.shelterNeed,
        warmthNeed: state.tribe.warmthNeed,
        starveTimer: state.tribe.starveTimer,
        freezeTimer: state.tribe.freezeTimer,
        unshelterTimer: state.tribe.unshelterTimer,
        causeOfDeath: state.tribe.causeOfDeath || '',
        growthAccumulator: state.growthAccumulator || 0,
      },
      resources: {
        food: state.resources.food,
        wood: state.resources.wood,
        stone: state.resources.stone,
        maxFood: state.resources.maxFood,
        maxWood: state.resources.maxWood,
        maxStone: state.resources.maxStone,
        spoiledLastTurn: state.resources.spoiledLastTurn || 0,
        burnedWoodLastTurn: state.resources.burnedWoodLastTurn || 0,
      },
      worldTiles: (state.worldTiles || []).map(t => ({
        x: t.x, y: t.y, type: t.type,
        depleted: !!t.depleted,
        depletedIn: Number(t.depletedIn) || 0,
        buildingId: t.buildingId || null,
        originalType: t.originalType || t.type,
        special: t.special || null,
        specialClaimed: !!t.specialClaimed,
      })),
      buildings: state.buildings,
      events: state.events || {},
      eventLog: (state.eventLog || []).slice(-40),
      exploredTiles: state.exploredTiles || [],
      morale: state.morale || {},
      merchant: state.merchant || {},
      achievements: state.achievements || {},
      buildingsPlacedTotal: state.buildingsPlacedTotal || 0,
      villagers: state.villagers || [],
      selectedVillagerId: state.selectedVillagerId || null,
      runStats: state.runStats || {},
      merchantBlueprints: state.merchantBlueprints || [],
    };
    raw.checksum = computeChecksum(raw);
    return raw;
  }

  function computeChecksum(data) {
    const clone = JSON.parse(JSON.stringify(data));
    delete clone.checksum;
    const json = JSON.stringify(clone);
    let h = 2166136261;
    for (let i = 0; i < json.length; i++) {
      h ^= json.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if ((raw.version || 1) === CURRENT_VERSION) return raw;

    const migrated = {
      ...raw,
      version: CURRENT_VERSION,
      events: raw.events || { history: raw.eventLog || [] },
      villagers: raw.villagers || [],
      selectedVillagerId: raw.selectedVillagerId || null,
      runStats: raw.runStats || {},
      merchantBlueprints: raw.merchantBlueprints || [],
    };

    migrated.worldTiles = (raw.worldTiles || []).map(t => ({
      ...t,
      depletedIn: t.depletedIn || 0,
      originalType: t.originalType || t.type,
      special: t.special || null,
      specialClaimed: !!t.specialClaimed,
    }));

    migrated.tribe = {
      ...raw.tribe,
      causeOfDeath: raw.tribe?.causeOfDeath || '',
      growthAccumulator: raw.growthAccumulator || raw.tribe?.growthAccumulator || 0,
    };

    migrated.resources = {
      ...raw.resources,
      spoiledLastTurn: raw.resources?.spoiledLastTurn || 0,
      burnedWoodLastTurn: raw.resources?.burnedWoodLastTurn || 0,
    };

    migrated.checksum = computeChecksum(migrated);
    return migrated;
  }

  function validate(raw) {
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'Not an object' };
    for (const [key, type] of Object.entries(SAVE_SCHEMA)) {
      if (!(key in raw)) return { ok: false, reason: `Missing key: ${key}` };
      if (typeof raw[key] !== type) return { ok: false, reason: `Bad type for ${key}: expected ${type}` };
    }
    if (raw.version !== CURRENT_VERSION) return { ok: false, reason: `Version mismatch: ${raw.version} vs ${CURRENT_VERSION}` };
    if (raw.checksum !== computeChecksum(raw)) return { ok: false, reason: 'Checksum mismatch' };
    if (raw.tribe.population < 0 || raw.tribe.population > 10000) return { ok: false, reason: 'Population out of range' };
    if (!Array.isArray(raw.worldTiles) || raw.worldTiles.length === 0) return { ok: false, reason: 'Invalid worldTiles' };
    return { ok: true };
  }

  function save(state) {
    try {
      const data = serialize(state);
      const json = JSON.stringify(data);
      const existing = localStorage.getItem(SAVE_KEY);
      if (existing) localStorage.setItem(BACKUP_KEY, existing);
      localStorage.setItem(SAVE_KEY, json);
      return true;
    } catch (e) {
      console.warn('[Save] Failed to save:', e.message);
      return false;
    }
  }

  function tryRead(key) {
    const json = localStorage.getItem(key);
    if (!json) return null;
    const raw = JSON.parse(json);
    return migrate(raw);
  }

  function load() {
    const sources = [
      { key: SAVE_KEY, label: 'primary' },
      { key: BACKUP_KEY, label: 'backup' },
      ...LEGACY_SAVE_KEYS.map(k => ({ key: k, label: 'legacy' })),
    ];
    for (const { key, label } of sources) {
      try {
        const raw = tryRead(key);
        if (!raw) continue;
        const check = validate(raw);
        if (check.ok) {
          console.info(`[Save] Loaded ${label} save (day ${raw.day})`);
          return raw;
        }
        console.warn(`[Save] ${label} save invalid: ${check.reason}`);
      } catch (e) {
        console.warn(`[Save] Error reading ${label} save:`, e.message);
      }
    }
    return null;
  }

  function hasSave() {
    try {
      const raw = tryRead(SAVE_KEY);
      return !!raw && validate(raw).ok;
    } catch {
      return false;
    }
  }

  function deleteSave() {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(BACKUP_KEY);
    for (const key of LEGACY_SAVE_KEYS) localStorage.removeItem(key);
  }

  return { save, load, hasSave, deleteSave };
})();
