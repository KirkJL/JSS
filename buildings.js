/**
 * BUILDINGS SYSTEM
 * ----------------
 * Defines all buildable structures and manages their placement,
 * effects, and queries (e.g. "how many shelter slots exist?").
 *
 * Buildings are placed on tiles. A tile can hold only one building.
 * Buildings are stored as a map: buildingId → building object.
 *
 * To extend:
 *   - Add new BUILDING_DEFS entries
 *   - Add new effect queries (e.g. getFarmBonus, getDefenseBonus)
 *   - Add building upgrades (level 1 → 2 via additional cost)
 */

const BuildingSystem = (() => {

  /**
   * Building definitions.
   * era: minimum era index to unlock (0=Stone Age, 1=Bronze Age, etc.)
   * effect: describes what it does (used by other systems)
   * allowedOn: tile types that can host this building
   */
  const BUILDING_DEFS = {
    SHELTER: {
      id: 'SHELTER',
      name: 'Shelter',
      emoji: '🏠',
      description: 'Houses 5 tribe members. Reduces exposure risk.',
      cost: { wood: 8, stone: 4 },
      era: 0,
      shelterCap: 5,
      warmthBonus: 3,
      allowedOn: ['ROCK', 'FERTILE', 'FOREST'],
    },
    STORAGE: {
      id: 'STORAGE',
      name: 'Storage',
      emoji: '🏚️',
      description: 'Increases max resource storage.',
      cost: { wood: 10, stone: 6 },
      era: 0,
      shelterCap: 0,
      warmthBonus: 0,
      allowedOn: ['ROCK', 'FERTILE', 'FOREST'],
    },
    WATCHTOWER: {
      id: 'WATCHTOWER',
      name: 'Watchtower',
      emoji: '🗼',
      description: 'Warns of incoming disasters 1 turn early.',
      cost: { wood: 12, stone: 8 },
      era: 0,
      shelterCap: 0,
      warmthBonus: 0,
      allowedOn: ['ROCK', 'SNOW'],
    },
    FARM: {
      id: 'FARM',
      name: 'Farm',
      emoji: '🌾',
      description: 'Produces +2 food each turn automatically.',
      cost: { wood: 6, stone: 2 },
      era: 1,  // unlocked at Bronze Age
      shelterCap: 0,
      warmthBonus: 0,
      allowedOn: ['FERTILE'],
      foodPerTurn: 2,
    },
    FIREPIT: {
      id: 'FIREPIT',
      name: 'Fire Pit',
      emoji: '🔥',
      description: 'Provides warmth for the whole tribe. +8 warmth/turn.',
      cost: { wood: 5, stone: 3 },
      era: 0,
      shelterCap: 0,
      warmthBonus: 8,
      allowedOn: ['ROCK', 'FERTILE', 'FOREST'],
    },
  };

  /** Create a fresh, empty building registry. */
  function create() {
    return {
      placed: {},        // buildingId → { defId, tileX, tileY, id }
      nextId: 1,
    };
  }

  /** Restore from save. */
  function fromSave(data) {
    return {
      placed: data.placed || {},
      nextId: data.nextId || 1,
    };
  }

  /**
   * Place a building on a tile.
   * @returns { ok: true, building } or { ok: false, reason: '...' }
   */
  function place(buildings, tile, defId, resources, era) {
    const def = BUILDING_DEFS[defId];
    if (!def) return { ok: false, reason: 'Unknown building type' };
    if (def.era > era) return { ok: false, reason: 'Not yet discovered' };

    // Tile eligibility
    if (!def.allowedOn.includes(tile.type))
      return { ok: false, reason: `Can't build on ${tile.type}` };
    if (tile.buildingId)
      return { ok: false, reason: 'Tile already has a building' };
    if (tile.depleted && defId !== 'FARM')
      return { ok: false, reason: 'Tile is depleted' };

    // Check & spend cost
    if (!ResourceSystem.canAfford(resources, def.cost))
      return { ok: false, reason: 'Not enough resources' };
    ResourceSystem.spend(resources, def.cost);

    // Register building
    const id = 'b' + buildings.nextId++;
    const building = { id, defId, tileX: tile.x, tileY: tile.y };
    buildings.placed[id] = building;
    tile.buildingId = id;
    tile.depleted   = false; // building tiles are not gatherable anyway

    return { ok: true, building };
  }

  /** Remove a building (e.g. destroyed by disaster). */
  function remove(buildings, buildingId, tiles) {
    const b = buildings.placed[buildingId];
    if (!b) return;
    const tile = tiles.find(t => t.x === b.tileX && t.y === b.tileY);
    if (tile) tile.buildingId = null;
    delete buildings.placed[buildingId];
  }

  /** Total shelter capacity from all placed Shelter buildings. */
  function getShelterCapacity(buildings) {
    let cap = 0;
    for (const b of Object.values(buildings.placed)) {
      cap += (BUILDING_DEFS[b.defId].shelterCap || 0);
    }
    return cap;
  }

  /** Total warmth bonus from all placed buildings. */
  function getWarmthBonus(buildings) {
    let bonus = 0;
    for (const b of Object.values(buildings.placed)) {
      bonus += (BUILDING_DEFS[b.defId].warmthBonus || 0);
    }
    return bonus;
  }

  /** Count how many Storage buildings exist. */
  function getStorageCount(buildings) {
    return Object.values(buildings.placed)
      .filter(b => b.defId === 'STORAGE').length;
  }

  /** Count how many Watchtowers exist. */
  function getWatchtowerCount(buildings) {
    return Object.values(buildings.placed)
      .filter(b => b.defId === 'WATCHTOWER').length;
  }

  /**
   * Process passive building effects each turn.
   * E.g. Farms produce food.
   */
  function processTurn(buildings, resources) {
    for (const b of Object.values(buildings.placed)) {
      const def = BUILDING_DEFS[b.defId];
      if (def.foodPerTurn) {
        resources.food = Math.min(
          resources.maxFood,
          resources.food + def.foodPerTurn
        );
      }
    }
  }

  /**
   * Returns a buildable-buildings list for the current era,
   * annotated with affordability.
   */
  function getAvailableBuildings(era, resources) {
    return Object.values(BUILDING_DEFS)
      .filter(def => def.era <= era)
      .map(def => ({
        ...def,
        affordable: ResourceSystem.canAfford(resources, def.cost),
      }));
  }

  // Expose getShelterCapacity and getWarmthBonus as methods on
  // a bound object so TribeSystem can call them without extra args
  function createProxy(buildingsState) {
    return {
      getShelterCapacity: () => getShelterCapacity(buildingsState),
      getWarmthBonus:     () => getWarmthBonus(buildingsState),
    };
  }

  return {
    BUILDING_DEFS,
    create,
    fromSave,
    place,
    remove,
    getShelterCapacity,
    getWarmthBonus,
    getStorageCount,
    getWatchtowerCount,
    processTurn,
    getAvailableBuildings,
    createProxy,
  };

})();
