/**
 * EVENT SYSTEM
 * ------------
 * Disaster pressure plus occasional clutch recovery moments.
 */
const EventSystem = (() => {
  const EVENT_DEFS = {
    FLOOD: {
      id: 'FLOOD',
      name: 'Flash Flood',
      emoji: '🌊',
      description: 'Raging waters pour down the mountain, swallowing low ground.',
      warningText: 'Storm clouds gather. A flood is coming!',
      severity: 'danger',
      minDay: 10,
      seasons: [0, 1, 2],
    },
    BLIZZARD: {
      id: 'BLIZZARD',
      name: 'Blizzard',
      emoji: '❄️',
      description: 'A howling blizzard freezes everything. Warmth plummets.',
      warningText: 'The sky turns pale grey. A blizzard approaches.',
      severity: 'danger',
      minDay: 5,
      seasons: [3, 0],
    },
    LANDSLIDE: {
      id: 'LANDSLIDE',
      name: 'Landslide',
      emoji: '💥',
      description: 'The mountainside gives way. Buildings are buried under rubble.',
      warningText: 'The ground trembles. A landslide is imminent!',
      severity: 'warn',
      minDay: 20,
      seasons: [0, 1, 2, 3],
    },
    HEATWAVE: {
      id: 'HEATWAVE',
      name: 'Heatwave',
      emoji: '☀️',
      description: 'Brutal heat spoils food stores and exhausts the tribe.',
      warningText: 'The air shimmers with heat. A heatwave is building.',
      severity: 'warn',
      minDay: 15,
      seasons: [1],
    },
  };

  function createState() {
    return {
      pendingEvent: null,
      activeEvent: null,
      history: [],
      nextEventIn: 20,
    };
  }

  function fromSave(data) {
    return {
      pendingEvent: data?.pendingEvent || null,
      activeEvent: null,
      history: data?.history || [],
      nextEventIn: data?.nextEventIn || 10,
    };
  }

  function rollEvent(day, season, rng) {
    const eligible = Object.values(EVENT_DEFS).filter(e => e.seasons.includes(season) && day >= e.minDay);
    if (!eligible.length) return null;
    const chance = Math.min(0.7, 0.15 + day * 0.0055);
    if (rng() > chance) return null;
    return eligible[Math.floor(rng() * eligible.length)];
  }

  function processTurn(eventState, world, tribe, resources, buildings, day, season, rng) {
    const msgs = [];
    eventState.activeEvent = null;
    const hasWatchtower = BuildingSystem.getWatchtowerCount(buildings) > 0;

    if (eventState.pendingEvent) {
      eventState.pendingEvent.turnsUntil--;
      if (eventState.pendingEvent.turnsUntil <= 0) {
        const def = EVENT_DEFS[eventState.pendingEvent.defId];
        eventState.activeEvent = { defId: def.id };
        const result = applyDisaster(def, world, tribe, resources, buildings, day, rng);
        msgs.push(...result.messages);
        eventState.history.push({ defId: def.id, day });
        eventState.pendingEvent = null;
        eventState.nextEventIn = 10 + Math.floor(rng() * 20);
      } else if (hasWatchtower && eventState.pendingEvent.turnsUntil === 1) {
        const def = EVENT_DEFS[eventState.pendingEvent.defId];
        msgs.push({ text: `⚠️ ${def.warningText}`, type: 'warn', banner: true });
      }
      maybeMiracle(eventState, tribe, resources, buildings, rng, msgs);
      return msgs;
    }

    eventState.nextEventIn--;
    if (eventState.nextEventIn > 0) {
      maybeMiracle(eventState, tribe, resources, buildings, rng, msgs);
      return msgs;
    }

    const rolled = rollEvent(day, season, rng);
    if (rolled) {
      const telegraphTurns = hasWatchtower ? 1 : 0;
      if (telegraphTurns > 0) {
        eventState.pendingEvent = { defId: rolled.id, turnsUntil: telegraphTurns };
        msgs.push({ text: `🗼 ${rolled.warningText}`, type: 'warn', banner: true });
      } else {
        eventState.pendingEvent = { defId: rolled.id, turnsUntil: 1 };
      }
    } else {
      eventState.nextEventIn = 5 + Math.floor(rng() * 10);
    }

    maybeMiracle(eventState, tribe, resources, buildings, rng, msgs);
    return msgs;
  }

  function maybeMiracle(eventState, tribe, resources, buildings, rng, msgs) {
    if (tribe.population > 2 || rng() > 0.15) return;
    const strat = BuildingSystem.getStrategySummary(buildings);
    if (rng() < Math.min(0.35, 0.08 + strat.miracleBoost)) {
      const bonusFood = 4 + Math.floor(rng() * 5);
      resources.food = Math.min(resources.maxFood, resources.food + bonusFood);
      tribe.warmthNeed = Math.min(100, tribe.warmthNeed + 12);
      msgs.push({ text: `✨ A miracle find kept the tribe alive: +${bonusFood} food`, type: 'good' });
      eventState.history.push({ defId: 'MIRACLE', day: -1 });
    }
  }

  function applyDisaster(def, world, tribe, resources, buildings, day, rng) {
    const msgs = [];
    const resilience = BuildingSystem.getStrategySummary(buildings).resilience || 0;
    msgs.push({ text: `${def.emoji} ${def.name.toUpperCase()} STRUCK!`, type: 'danger', banner: true });

    switch (def.id) {
      case 'FLOOD': {
        let flooded = 0, destroyed = 0;
        for (const tile of world.tiles) {
          if (tile.height < 0.40 && tile.moisture > 0.45 && rng() < (0.55 - resilience * 0.4)) {
            if (tile.type !== 'PEAK' && tile.type !== 'FLOODED') {
              tile.originalType = tile.type;
              tile.type = 'FLOODED';
              flooded++;
              if (tile.buildingId && rng() > resilience) {
                BuildingSystem.remove(buildings, tile.buildingId, world.tiles);
                destroyed++;
              }
            }
          }
        }
        for (const tile of world.tiles) {
          if (tile.type === 'FLOODED' && rng() < 0.3) tile.type = tile.originalType || 'FERTILE';
        }
        msgs.push({ text: `${flooded} tiles flooded. ${destroyed} buildings destroyed.`, type: 'danger' });
        resources.food = Math.max(0, resources.food - Math.floor(resources.food * (0.3 - resilience * 0.2)));
        tribe.warmthNeed = Math.max(0, tribe.warmthNeed - Math.floor(25 * (1 - resilience)));
        break;
      }
      case 'BLIZZARD': {
        tribe.warmthNeed = Math.max(0, tribe.warmthNeed - Math.floor(50 * (1 - resilience)));
        tribe.foodNeed = Math.max(0, tribe.foodNeed - 15);
        let frozen = 0;
        for (const tile of world.tiles) {
          if ((tile.type === 'FERTILE' || tile.type === 'FOREST') && rng() < (0.25 - resilience * 0.1)) {
            tile.originalType = tile.type;
            tile.type = 'SNOW';
            frozen++;
          }
        }
        msgs.push({ text: `Tribe warmth crashed. ${frozen} tiles frozen over.`, type: 'danger' });
        world._blizzardThaw = 3;
        break;
      }
      case 'LANDSLIDE': {
        const col = Math.floor(rng() * world.width);
        const startY = Math.floor(rng() * world.height * 0.3);
        const length = 3 + Math.floor(rng() * 4);
        let destroyed = 0;
        for (let dy = 0; dy < length; dy++) {
          const y = startY + dy;
          if (y >= world.height) break;
          for (let dx = -1; dx <= 1; dx++) {
            if (rng() < (dx === 0 ? 0.9 : 0.4)) {
              const x = col + dx;
              const tile = WorldGen.getTile(world, x, y);
              if (!tile || tile.type === 'PEAK') continue;
              if (tile.buildingId && rng() > resilience) {
                BuildingSystem.remove(buildings, tile.buildingId, world.tiles);
                destroyed++;
              }
              tile.type = 'ASH';
              tile.depleted = true;
              tile.depletedIn = 15;
            }
          }
        }
        msgs.push({ text: `Landslide buried terrain. ${destroyed} buildings lost.`, type: 'warn' });
        resources.stone = Math.min(resources.maxStone, resources.stone + 5);
        break;
      }
      case 'HEATWAVE': {
        const spoiled = Math.floor(resources.food * (0.35 - resilience * 0.15));
        resources.food = Math.max(0, resources.food - spoiled);
        tribe.foodNeed = Math.max(0, tribe.foodNeed - 20);
        msgs.push({ text: `${spoiled} food spoiled in the heat.`, type: 'warn' });
        break;
      }
    }
    return { messages: msgs };
  }

  function processWorldPassive(world) {
    if (world._blizzardThaw > 0) {
      world._blizzardThaw--;
      if (world._blizzardThaw === 0) {
        for (const tile of world.tiles) {
          if (tile.type === 'SNOW' && tile.originalType && tile.originalType !== 'SNOW') {
            tile.type = tile.originalType;
          }
        }
      }
    }
  }

  function getPendingWarning(eventState) {
    if (!eventState.pendingEvent) return null;
    const def = EVENT_DEFS[eventState.pendingEvent.defId];
    return {
      emoji: def.emoji,
      text: `${def.warningText} (${eventState.pendingEvent.turnsUntil} turn${eventState.pendingEvent.turnsUntil > 1 ? 's' : ''})`,
    };
  }

  return {
    EVENT_DEFS,
    createState,
    fromSave,
    processTurn,
    processWorldPassive,
    getPendingWarning,
  };
})();
