/**
 * RESOURCE SYSTEM
 * ---------------
 * Manages the three core resources: Food, Wood, Stone.
 * Handles gathering from tiles with depletion, and storage capacity.
 *
 * To extend:
 *   - Add new resource types (coal, iron) for later eras
 *   - Add gathering efficiency bonuses from buildings
 *   - Add seasonal gathering modifiers (winter = less food)
 */

const ResourceSystem = (() => {

  // How many turns until a depleted tile starts to regrow
  const REGROW_TURNS = { FOREST: 8, FERTILE: 5, ROCK: 20 };

  // Base gather amounts per tile type (before bonuses)
  // Defined in TILE_DEFS but we read them dynamically

  // Storage caps (start small, increase with Storage buildings)
  const BASE_CAPS = { food: 50, wood: 40, stone: 40 };
  const STORAGE_BONUS = { food: 30, wood: 25, stone: 25 };

  /** Create a fresh resource state. */
  function create() {
    return {
      food:  20,
      wood:  15,
      stone: 10,
      maxFood:  BASE_CAPS.food,
      maxWood:  BASE_CAPS.wood,
      maxStone: BASE_CAPS.stone,
    };
  }

  /** Restore from save. */
  function fromSave(data) {
    return {
      food:  clamp(data.food,  0, data.maxFood),
      wood:  clamp(data.wood,  0, data.maxWood),
      stone: clamp(data.stone, 0, data.maxStone),
      maxFood:  data.maxFood,
      maxWood:  data.maxWood,
      maxStone: data.maxStone,
    };
  }

  /**
   * Recalculate storage caps based on number of Storage buildings.
   * Call this whenever a building is placed or destroyed.
   */
  function recalcCaps(resources, storageCount) {
    resources.maxFood  = BASE_CAPS.food  + storageCount * STORAGE_BONUS.food;
    resources.maxWood  = BASE_CAPS.wood  + storageCount * STORAGE_BONUS.wood;
    resources.maxStone = BASE_CAPS.stone + storageCount * STORAGE_BONUS.stone;
    // Clamp current amounts
    resources.food  = Math.min(resources.food,  resources.maxFood);
    resources.wood  = Math.min(resources.wood,  resources.maxWood);
    resources.stone = Math.min(resources.stone, resources.maxStone);
  }

  /**
   * Attempt to gather from a tile.
   * @param {object} tile      - tile object (mutated if depleted)
   * @param {object} resources - resource pool (mutated)
   * @param {number} season    - 0-3; winter reduces food yield
   * @returns {object|null} { food, wood, stone } gained, or null if nothing gathered
   */
  function gatherTile(tile, resources, season) {
    const def = WorldGen.TILE_DEFS[tile.type];
    if (!def || !def.passable || tile.depleted || tile.buildingId) return null;
    if (Object.keys(def.gatherYield).length === 0) return null;

    const gained = { food: 0, wood: 0, stone: 0 };

    // Winter halves food yield
    const winterPenalty = season === 3 ? .5 : 1;

    for (const [res, amt] of Object.entries(def.gatherYield)) {
      let actual = Math.floor(amt * (res === 'food' ? winterPenalty : 1));
      actual = Math.max(0, actual);
      const space = resources['max' + capitalize(res)] - resources[res];
      actual = Math.min(actual, space);
      if (actual > 0) {
        resources[res] += actual;
        gained[res]     += actual;
      }
    }

    // Mark tile depleted after gathering
    tile.depleted = true;
    tile.depletedIn = REGROW_TURNS[tile.type] || 10;

    const total = gained.food + gained.wood + gained.stone;
    return total > 0 ? gained : null;
  }

  /**
   * Process tile regrowth each turn.
   * Depleted tiles countdown and eventually recover.
   */
  function processTurnRegrowth(tiles) {
    for (const tile of tiles) {
      if (!tile.depleted) continue;
      tile.depletedIn = Math.max(0, tile.depletedIn - 1);
      if (tile.depletedIn === 0) {
        tile.depleted = false;
      }
    }
  }

  /**
   * Spend resources. Returns true if affordable, false if not.
   * Does NOT mutate if can't afford (atomic check).
   */
  function spend(resources, cost) {
    for (const [res, amt] of Object.entries(cost)) {
      if ((resources[res] || 0) < amt) return false;
    }
    for (const [res, amt] of Object.entries(cost)) {
      resources[res] -= amt;
    }
    return true;
  }

  /** Check if a cost can be afforded without spending. */
  function canAfford(resources, cost) {
    for (const [res, amt] of Object.entries(cost)) {
      if ((resources[res] || 0) < amt) return false;
    }
    return true;
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  return {
    create,
    fromSave,
    recalcCaps,
    gatherTile,
    processTurnRegrowth,
    spend,
    canAfford,
  };

})();
