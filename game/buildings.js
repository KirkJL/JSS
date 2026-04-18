/**
 * BUILDINGS SYSTEM
 * ----------------
 * Buildings now define actual strategy lanes:
 * economy, defense, exploration, morale, and trading.
 * Everything remains additive to the original game loop.
 */
const BuildingSystem = (() => {
  const BUILDING_DEFS = {
    SHELTER: {
      id: 'SHELTER',
      name: 'Shelter',
      emoji: '🏠',
      description: 'Houses 5 tribe members. Strong defensive foundation for harsh runs.',
      cost: { wood: 8, stone: 4 },
      era: 0,
      shelterCap: 5,
      warmthBonus: 3,
      role: 'defense',
      allowedOn: ['ROCK', 'FERTILE', 'FOREST'],
      strategyText: '+5 shelter, +3 warmth, +5 morale/turn stabiliser',
      moralePerTurn: 1,
      resilience: 0.08,
    },
    STORAGE: {
      id: 'STORAGE',
      name: 'Storage',
      emoji: '🏚️',
      description: 'Increases max storage and reduces spoilage.',
      cost: { wood: 10, stone: 6 },
      era: 0,
      shelterCap: 0,
      warmthBonus: 0,
      role: 'economy',
      allowedOn: ['ROCK', 'FERTILE', 'FOREST'],
      strategyText: '+capacity, -spoilage, better stockpile runs',
      spoilageReduction: 0.08,
    },
    WATCHTOWER: {
      id: 'WATCHTOWER',
      name: 'Watchtower',
      emoji: '🗼',
      description: 'Warns of incoming disasters and reveals more ground.',
      cost: { wood: 12, stone: 8 },
      era: 0,
      shelterCap: 0,
      warmthBonus: 0,
      role: 'exploration',
      allowedOn: ['ROCK', 'SNOW'],
      strategyText: 'Event warning, +vision, +flood/slide resistance',
      revealRange: 1,
      resilience: 0.18,
    },
    FARM: {
      id: 'FARM',
      name: 'Farm',
      emoji: '🌾',
      description: 'Produces food every turn and boosts fertile gathering.',
      cost: { wood: 6, stone: 2 },
      era: 1,
      shelterCap: 0,
      warmthBonus: 0,
      role: 'economy',
      allowedOn: ['FERTILE'],
      strategyText: '+3 food/turn, fertile runs snowball harder',
      foodPerTurn: 3,
      gatherBonus: { FERTILE: { food: 1 } },
    },
    FIREPIT: {
      id: 'FIREPIT',
      name: 'Fire Pit',
      emoji: '🔥',
      description: 'Provides warmth, morale, and a winter buffer.',
      cost: { wood: 5, stone: 3 },
      era: 0,
      shelterCap: 0,
      warmthBonus: 8,
      role: 'defense',
      allowedOn: ['ROCK', 'FERTILE', 'FOREST'],
      strategyText: '+8 warmth, +4 morale, lower winter wood burn',
      moralePerTurn: 2,
      winterWoodReduction: 1,
    },
    LUMBER_CAMP: {
      id: 'LUMBER_CAMP',
      name: 'Lumber Camp',
      emoji: '🪓',
      description: 'Makes forest-heavy starts worth committing to.',
      cost: { wood: 7, stone: 2 },
      era: 0,
      shelterCap: 0,
      warmthBonus: 0,
      role: 'economy',
      allowedOn: ['FOREST'],
      strategyText: '+2 wood/turn, forest gather bonus, storm prep',
      woodPerTurn: 2,
      gatherBonus: { FOREST: { wood: 2 } },
      resilience: 0.05,
    },
    QUARRY: {
      id: 'QUARRY',
      name: 'Quarry',
      emoji: '⛏️',
      description: 'Turns rocky starts into build-heavy runs.',
      cost: { wood: 4, stone: 6 },
      era: 0,
      shelterCap: 0,
      warmthBonus: 0,
      role: 'economy',
      allowedOn: ['ROCK', 'ASH'],
      strategyText: '+2 stone/turn, rock gather bonus',
      stonePerTurn: 2,
      gatherBonus: { ROCK: { stone: 2 }, ASH: { stone: 1 } },
    },
    SHRINE: {
      id: 'SHRINE',
      name: 'Shrine',
      emoji: '⛩️',
      description: 'A morale anchor for longer runs and miracle recoveries.',
      cost: { wood: 8, stone: 8 },
      era: 1,
      shelterCap: 0,
      warmthBonus: 0,
      role: 'morale',
      allowedOn: ['ROCK', 'FERTILE', 'FOREST', 'SNOW'],
      strategyText: '+4 morale/turn, better comeback odds, better merchant mood',
      moralePerTurn: 4,
      miracleBoost: 0.10,
      merchantBonus: 1,
    },
  };

  function create() {
    return { placed: {}, nextId: 1 };
  }

  function fromSave(data) {
    return { placed: data?.placed || {}, nextId: data?.nextId || 1 };
  }

  function place(buildings, tile, defId, resources, era) {
    const def = BUILDING_DEFS[defId];
    if (!def) return { ok: false, reason: 'Unknown building type' };
    if (def.era > era) return { ok: false, reason: 'Not yet discovered' };
    if (!def.allowedOn.includes(tile.type)) return { ok: false, reason: `Can't build on ${tile.type}` };
    if (tile.buildingId) return { ok: false, reason: 'Tile already has a building' };
    if (tile.depleted && defId !== 'FARM') return { ok: false, reason: 'Tile is depleted' };
    if (!ResourceSystem.canAfford(resources, def.cost)) return { ok: false, reason: 'Not enough resources' };

    ResourceSystem.spend(resources, def.cost);
    const id = 'b' + buildings.nextId++;
    const building = { id, defId, tileX: tile.x, tileY: tile.y };
    buildings.placed[id] = building;
    tile.buildingId = id;
    tile.depleted = false;
    return { ok: true, building };
  }

  function remove(buildings, buildingId, tiles) {
    const b = buildings.placed[buildingId];
    if (!b) return;
    const tile = tiles.find(t => t.x === b.tileX && t.y === b.tileY);
    if (tile) tile.buildingId = null;
    delete buildings.placed[buildingId];
  }

  function getShelterCapacity(buildings) {
    let cap = 0;
    for (const b of Object.values(buildings.placed)) cap += BUILDING_DEFS[b.defId].shelterCap || 0;
    return cap;
  }

  function getWarmthBonus(buildings) {
    let bonus = 0;
    for (const b of Object.values(buildings.placed)) bonus += BUILDING_DEFS[b.defId].warmthBonus || 0;
    return bonus;
  }

  function getStorageCount(buildings) {
    return Object.values(buildings.placed).filter(b => b.defId === 'STORAGE').length;
  }

  function getWatchtowerCount(buildings) {
    return Object.values(buildings.placed).filter(b => b.defId === 'WATCHTOWER').length;
  }

  function getStrategySummary(buildings) {
    const out = {
      roles: {},
      moralePerTurn: 0,
      resilience: 0,
      revealRange: 0,
      spoilageReduction: 0,
      winterWoodReduction: 0,
      merchantBonus: 0,
      miracleBoost: 0,
      gatherBonus: {},
    };

    for (const b of Object.values(buildings.placed)) {
      const def = BUILDING_DEFS[b.defId];
      out.roles[def.role] = (out.roles[def.role] || 0) + 1;
      out.moralePerTurn += def.moralePerTurn || 0;
      out.resilience += def.resilience || 0;
      out.revealRange += def.revealRange || 0;
      out.spoilageReduction += def.spoilageReduction || 0;
      out.winterWoodReduction += def.winterWoodReduction || 0;
      out.merchantBonus += def.merchantBonus || 0;
      out.miracleBoost += def.miracleBoost || 0;

      if (def.gatherBonus) {
        for (const [tileType, bonus] of Object.entries(def.gatherBonus)) {
          out.gatherBonus[tileType] = out.gatherBonus[tileType] || { food: 0, wood: 0, stone: 0 };
          for (const res of ['food', 'wood', 'stone']) {
            out.gatherBonus[tileType][res] += bonus[res] || 0;
          }
        }
      }
    }

    out.resilience = Math.min(0.45, out.resilience);
    out.spoilageReduction = Math.min(0.45, out.spoilageReduction);
    return out;
  }

  function getGatherBonus(buildings, tileType) {
    const strat = getStrategySummary(buildings);
    return strat.gatherBonus[tileType] || { food: 0, wood: 0, stone: 0 };
  }

  function processTurn(buildings, resources, moraleState) {
    const messages = [];
    for (const b of Object.values(buildings.placed)) {
      const def = BUILDING_DEFS[b.defId];
      if (def.foodPerTurn) {
        const before = resources.food;
        resources.food = Math.min(resources.maxFood, resources.food + def.foodPerTurn);
        if (resources.food > before) messages.push({ text: `${def.emoji} ${def.name} produced +${resources.food - before} food`, type: 'good' });
      }
      if (def.woodPerTurn) {
        const before = resources.wood;
        resources.wood = Math.min(resources.maxWood, resources.wood + def.woodPerTurn);
        if (resources.wood > before) messages.push({ text: `${def.emoji} ${def.name} produced +${resources.wood - before} wood`, type: 'good' });
      }
      if (def.stonePerTurn) {
        const before = resources.stone;
        resources.stone = Math.min(resources.maxStone, resources.stone + def.stonePerTurn);
        if (resources.stone > before) messages.push({ text: `${def.emoji} ${def.name} produced +${resources.stone - before} stone`, type: 'good' });
      }
      if (moraleState && def.moralePerTurn) {
        moraleState.morale = Math.min(100, moraleState.morale + def.moralePerTurn);
      }
    }
    return messages;
  }

  function getAvailableBuildings(era, resources) {
    return Object.values(BUILDING_DEFS)
      .filter(def => def.era <= era)
      .map(def => ({ ...def, affordable: ResourceSystem.canAfford(resources, def.cost) }));
  }

  function getDominantStrategy(buildings) {
    const roles = getStrategySummary(buildings).roles;
    let best = 'balanced', bestCount = 0;
    for (const [role, count] of Object.entries(roles)) {
      if (count > bestCount) { best = role; bestCount = count; }
    }
    return best;
  }

  function createProxy(buildingsState) {
    return {
      getShelterCapacity: () => getShelterCapacity(buildingsState),
      getWarmthBonus: () => getWarmthBonus(buildingsState),
      getResilience: () => getStrategySummary(buildingsState).resilience,
      getMoralePerTurn: () => getStrategySummary(buildingsState).moralePerTurn,
      getSpoilageReduction: () => getStrategySummary(buildingsState).spoilageReduction,
      getWinterWoodReduction: () => getStrategySummary(buildingsState).winterWoodReduction,
      getMerchantBonus: () => getStrategySummary(buildingsState).merchantBonus,
      getMiracleBoost: () => getStrategySummary(buildingsState).miracleBoost,
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
    getStrategySummary,
    getGatherBonus,
    getDominantStrategy,
    processTurn,
    getAvailableBuildings,
    createProxy,
  };
})();
