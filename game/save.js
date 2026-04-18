/**
 * SAVE SYSTEM
 * -----------
 * Handles all persistence via localStorage.
 * Validates loaded data to prevent crashes from corrupted/tampered saves.
 *
 * To extend: add new top-level keys to SAVE_SCHEMA and update serialize/deserialize.
 */

const SaveSystem = (() => {

  const SAVE_KEY   = 'peak_survivors_save_v1';
  const BACKUP_KEY = 'peak_survivors_save_v1_bak';

  // ---- Schema for validation (minimum required keys) ----
  const SAVE_SCHEMA = {
    version: 'number',
    seed: 'string',
    day: 'number',
    year: 'number',
    season: 'number',
    era: 'number',
    tribe: 'object',
    resources: 'object',
    worldTiles: 'object',
    buildings: 'object',
    // exploredTiles and growthAccumulator are optional (added later)
  };

  const CURRENT_VERSION = 1;

  /**
   * Serialize the full game state into a JSON-safe plain object.
   * Called by the game engine before writing to localStorage.
   */
  function serialize(state) {
    return {
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
      },
      resources: {
        food: state.resources.food,
        wood: state.resources.wood,
        stone: state.resources.stone,
        maxFood: state.resources.maxFood,
        maxWood: state.resources.maxWood,
        maxStone: state.resources.maxStone,
      },
      // Tiles stored as a flat array of minimal data to save space
      worldTiles: state.worldTiles.map(t => ({
        x: t.x, y: t.y, type: t.type,
        depleted: t.depleted,
        buildingId: t.buildingId || null,
      })),
      buildings: state.buildings,
      eventLog:          (state.eventLog || []).slice(-30),
      exploredTiles:        state.exploredTiles || [],
      growthAccumulator:    state.growthAccumulator || 0,
      morale:               state.morale   || {},
      merchant:             state.merchant || {},
      achievements:         state.achievements || {},
      buildingsPlacedTotal: state.buildingsPlacedTotal || 0,
    };
  }

  /**
   * Validate a raw parsed save object.
   * Returns { ok: true } or { ok: false, reason: '...' }
   */
  function validate(raw) {
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'Not an object' };

    for (const [key, type] of Object.entries(SAVE_SCHEMA)) {
      if (!(key in raw)) return { ok: false, reason: `Missing key: ${key}` };
      if (typeof raw[key] !== type) return { ok: false, reason: `Bad type for ${key}: expected ${type}` };
    }

    if (raw.version !== CURRENT_VERSION)
      return { ok: false, reason: `Version mismatch: ${raw.version} vs ${CURRENT_VERSION}` };

    // Basic sanity checks
    if (raw.tribe.population < 0 || raw.tribe.population > 10000)
      return { ok: false, reason: 'Population out of range' };
    if (!Array.isArray(raw.worldTiles) || raw.worldTiles.length === 0)
      return { ok: false, reason: 'Invalid worldTiles' };

    return { ok: true };
  }

  /** Write save. Makes a backup of the previous save first. */
  function save(state) {
    try {
      const data = serialize(state);
      const json = JSON.stringify(data);

      // Rotate: current → backup before overwriting
      const existing = localStorage.getItem(SAVE_KEY);
      if (existing) localStorage.setItem(BACKUP_KEY, existing);

      localStorage.setItem(SAVE_KEY, json);
      return true;
    } catch (e) {
      console.warn('[Save] Failed to save:', e.message);
      return false;
    }
  }

  /** Load and validate. Falls back to backup if primary is corrupt. */
  function load() {
    const sources = [
      { key: SAVE_KEY,   label: 'primary' },
      { key: BACKUP_KEY, label: 'backup'  },
    ];

    for (const { key, label } of sources) {
      try {
        const json = localStorage.getItem(key);
        if (!json) continue;

        const raw = JSON.parse(json);
        const check = validate(raw);

        if (check.ok) {
          console.info(`[Save] Loaded ${label} save (day ${raw.day})`);
          return raw;
        } else {
          console.warn(`[Save] ${label} save invalid: ${check.reason}`);
        }
      } catch (e) {
        console.warn(`[Save] Error reading ${label} save:`, e.message);
      }
    }
    return null;
  }

  /** Check if a valid save exists (for enabling "Continue" button). */
  function hasSave() {
    try {
      const json = localStorage.getItem(SAVE_KEY);
      if (!json) return false;
      const raw = JSON.parse(json);
      return validate(raw).ok;
    } catch { return false; }
  }

  /** Wipe all saves. */
  function deleteSave() {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(BACKUP_KEY);
  }

  return { save, load, hasSave, deleteSave };

})();
