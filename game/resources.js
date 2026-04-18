/**
 * RESOURCE SYSTEM
 * ---------------
 * Adds gather modifiers, seasonal pressure, spoilage, and safe save-state restores.
 */
const ResourceSystem = (() => {
  const REGROW_TURNS = { FOREST: 8, FERTILE: 5, ROCK: 20, ASH: 14 };
  const BASE_CAPS = { food: 50, wood: 40, stone: 40 };
  const STORAGE_BONUS = { food: 30, wood: 25, stone: 25 };

  function create() {
    return {
      food: 20,
      wood: 15,
      stone: 10,
      maxFood: BASE_CAPS.food,
      maxWood: BASE_CAPS.wood,
      maxStone: BASE_CAPS.stone,
      spoiledLastTurn: 0,
      burnedWoodLastTurn: 0,
    };
  }

  function fromSave(data) {
    const safeMaxFood = Math.max(BASE_CAPS.food, Number(data?.maxFood) || BASE_CAPS.food);
    const safeMaxWood = Math.max(BASE_CAPS.wood, Number(data?.maxWood) || BASE_CAPS.wood);
    const safeMaxStone = Math.max(BASE_CAPS.stone, Number(data?.maxStone) || BASE_CAPS.stone);
    return {
      food: clamp(Number(data?.food) || 0, 0, safeMaxFood),
      wood: clamp(Number(data?.wood) || 0, 0, safeMaxWood),
      stone: clamp(Number(data?.stone) || 0, 0, safeMaxStone),
      maxFood: safeMaxFood,
      maxWood: safeMaxWood,
      maxStone: safeMaxStone,
      spoiledLastTurn: Number(data?.spoiledLastTurn) || 0,
      burnedWoodLastTurn: Number(data?.burnedWoodLastTurn) || 0,
    };
  }

  function recalcCaps(resources, storageCount) {
    resources.maxFood = BASE_CAPS.food + storageCount * STORAGE_BONUS.food;
    resources.maxWood = BASE_CAPS.wood + storageCount * STORAGE_BONUS.wood;
    resources.maxStone = BASE_CAPS.stone + storageCount * STORAGE_BONUS.stone;
    resources.food = Math.min(resources.food, resources.maxFood);
    resources.wood = Math.min(resources.wood, resources.maxWood);
    resources.stone = Math.min(resources.stone, resources.maxStone);
  }

  function gatherTile(tile, resources, season, gatherBonus = null, gatherMultiplier = 1) {
    const def = WorldGen.TILE_DEFS[tile.type];
    if (!def || !def.passable || tile.depleted || tile.buildingId) return null;
    if (Object.keys(def.gatherYield).length === 0) return null;

    const bonus = gatherBonus || { food: 0, wood: 0, stone: 0 };
    const gained = { food: 0, wood: 0, stone: 0 };
    const winterPenalty = season === 3 ? 0.5 : 1;

    for (const [res, amt] of Object.entries(def.gatherYield)) {
      let actual = amt + (bonus[res] || 0);
      actual *= (res === 'food' ? winterPenalty : 1);
      actual *= gatherMultiplier || 1;
      actual = Math.floor(actual);
      actual = Math.max(0, actual);
      const space = resources['max' + capitalize(res)] - resources[res];
      actual = Math.min(actual, space);
      if (actual > 0) {
        resources[res] += actual;
        gained[res] += actual;
      }
    }

    tile.depleted = true;
    tile.depletedIn = REGROW_TURNS[tile.type] || 10;
    const total = gained.food + gained.wood + gained.stone;
    return total > 0 ? gained : null;
  }

  function processTurnRegrowth(tiles) {
    for (const tile of tiles) {
      if (!tile.depleted) continue;
      tile.depletedIn = Math.max(0, tile.depletedIn - 1);
      if (tile.depletedIn === 0) tile.depleted = false;
    }
  }

  function applyTurnPressure(resources, season, population, buildingsProxy = null) {
    const messages = [];
    const spoilageReduction = buildingsProxy?.getSpoilageReduction?.() || 0;
    const winterWoodReduction = buildingsProxy?.getWinterWoodReduction?.() || 0;

    resources.spoiledLastTurn = 0;
    resources.burnedWoodLastTurn = 0;

    if (resources.food > 35) {
      const spoilRate = Math.max(0, 0.06 - spoilageReduction);
      const spoiled = Math.floor(resources.food * spoilRate);
      if (spoiled > 0) {
        resources.food = Math.max(0, resources.food - spoiled);
        resources.spoiledLastTurn = spoiled;
        messages.push({ text: `🥀 ${spoiled} food spoiled in storage`, type: 'warn' });
      }
    }

    if (season === 3) {
      const burn = Math.max(0, 2 + Math.floor(population / 10) - winterWoodReduction);
      if (burn > 0) {
        const actualBurn = Math.min(resources.wood, burn);
        resources.wood -= actualBurn;
        resources.burnedWoodLastTurn = actualBurn;
        if (actualBurn > 0) messages.push({ text: `🔥 Winter consumed ${actualBurn} wood`, type: 'warn' });
      }
    }

    return messages;
  }

  function spend(resources, cost) {
    for (const [res, amt] of Object.entries(cost)) {
      if ((resources[res] || 0) < amt) return false;
    }
    for (const [res, amt] of Object.entries(cost)) resources[res] -= amt;
    return true;
  }

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
    applyTurnPressure,
    spend,
    canAfford,
  };
})();
