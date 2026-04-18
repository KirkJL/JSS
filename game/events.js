/**
 * EVENT SYSTEM
 * ------------
 * Manages random disaster events that threaten the tribe.
 * Events are telegraphed 1 turn early if a Watchtower exists.
 * Later turns = higher frequency and severity.
 *
 * Disaster types:
 *   FLOOD      – turns low-lying tiles to FLOODED, destroys buildings
 *   BLIZZARD   – massive warmth drain, kills unsheltered
 *   LANDSLIDE  – destroys tiles/buildings in a strip
 *   HEATWAVE   – food spoilage, warmth penalty (Summer only)
 *
 * To extend:
 *   - Add VOLCANIC_ASH, EARTHQUAKE, PLAGUE, etc.
 *   - Add positive events: Migration (+pop), Salvage (+resources)
 */

const EventSystem = (() => {

  // ---- Event definitions ----
  const EVENT_DEFS = {
    FLOOD: {
      id: 'FLOOD',
      name: 'Flash Flood',
      emoji: '🌊',
      description: 'Raging waters pour down the mountain, swallowing low ground.',
      warningText: 'Storm clouds gather. A flood is coming!',
      severity: 'danger',
      minDay: 10,
      // Which seasons it can occur in (0=Spring, 1=Summer, 2=Autumn, 3=Winter)
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

  // ---- State ----
  // pendingEvent: { defId, turnsUntil } — the next disaster in the pipeline
  // activeEvent: { defId } — currently active (applied this turn)
  // history: array of { defId, day } — for the event log

  function createState() {
    return {
      pendingEvent:  null,
      activeEvent:   null,
      history:       [],
      nextEventIn:   20,  // turns until next event check
    };
  }

  function fromSave(data) {
    return {
      pendingEvent:  data.pendingEvent  || null,
      activeEvent:   null,
      history:       data.history       || [],
      nextEventIn:   data.nextEventIn   || 10,
    };
  }

  /**
   * Roll for a new disaster event.
   * Probability scales with how long the tribe has survived.
   */
  function rollEvent(day, season, rng) {
    // Eligible disasters for this season
    const eligible = Object.values(EVENT_DEFS)
      .filter(e => e.seasons.includes(season) && day >= e.minDay);

    if (eligible.length === 0) return null;

    // Scale frequency: starts rare, becomes common
    // By day 100, ~70% chance per roll
    const chance = Math.min(.7, .15 + day * .0055);
    if (rng() > chance) return null;

    // Pick a random eligible event
    return eligible[Math.floor(rng() * eligible.length)];
  }

  /**
   * Process events at start of turn.
   * Returns an array of messages to display.
   */
  function processTurn(eventState, world, tribe, resources, buildings, day, season, rng) {
    const msgs = [];
    eventState.activeEvent = null;

    const hasWatchtower = BuildingSystem.getWatchtowerCount(buildings) > 0;

    // ---- Countdown pending event ----
    if (eventState.pendingEvent) {
      eventState.pendingEvent.turnsUntil--;

      if (eventState.pendingEvent.turnsUntil <= 0) {
        // Fire the event!
        const def = EVENT_DEFS[eventState.pendingEvent.defId];
        eventState.activeEvent = { defId: def.id };
        const result = applyDisaster(def, world, tribe, resources, buildings, day, rng);
        msgs.push(...result.messages);
        eventState.history.push({ defId: def.id, day });
        eventState.pendingEvent = null;
        eventState.nextEventIn  = 10 + Math.floor(rng() * 20); // cooldown
      } else if (hasWatchtower && eventState.pendingEvent.turnsUntil === 1) {
        const def = EVENT_DEFS[eventState.pendingEvent.defId];
        msgs.push({
          text: `⚠️ ${def.warningText}`,
          type: 'warn',
          banner: true,
        });
      }
      return msgs;
    }

    // ---- Cooldown countdown ----
    eventState.nextEventIn--;
    if (eventState.nextEventIn > 0) return msgs;

    // ---- Roll for new event ----
    const rolled = rollEvent(day, season, rng);
    if (rolled) {
      const telegraphTurns = hasWatchtower ? 1 : 0;
      if (telegraphTurns > 0) {
        eventState.pendingEvent = { defId: rolled.id, turnsUntil: telegraphTurns };
        msgs.push({
          text: `🗼 ${rolled.warningText}`,
          type: 'warn',
          banner: true,
        });
      } else {
        // Instant (no watchtower) — apply immediately next turn
        eventState.pendingEvent = { defId: rolled.id, turnsUntil: 1 };
      }
    } else {
      // No event this roll; try again in a few turns
      eventState.nextEventIn = 5 + Math.floor(rng() * 10);
    }

    return msgs;
  }

  /**
   * Apply a disaster to the world.
   * Mutates world tiles, tribe, resources, buildings.
   * Returns { messages: [...] }
   */
  function applyDisaster(def, world, tribe, resources, buildings, day, rng) {
    const msgs = [];
    msgs.push({ text: `${def.emoji} ${def.name.toUpperCase()} STRUCK!`, type: 'danger', banner: true });

    switch (def.id) {

      case 'FLOOD': {
        // Flood low-altitude tiles (moisture > .5 and height < .4)
        let flooded = 0, destroyed = 0;
        for (const tile of world.tiles) {
          if (tile.height < .40 && tile.moisture > .45 && rng() < .55) {
            // Don't flood PEAK or already-flooded
            if (tile.type !== 'PEAK' && tile.type !== 'FLOODED') {
              tile.originalType = tile.type;
              tile.type = 'FLOODED';
              flooded++;

              // Destroy any building on this tile
              if (tile.buildingId) {
                BuildingSystem.remove(buildings, tile.buildingId, world.tiles);
                destroyed++;
              }
            }
          }
        }
        // Recede some existing floods
        for (const tile of world.tiles) {
          if (tile.type === 'FLOODED' && rng() < .3) {
            tile.type = tile.originalType || 'FERTILE';
          }
        }
        msgs.push({ text: `${flooded} tiles flooded. ${destroyed} buildings destroyed.`, type: 'danger' });

        // Food and warmth penalty
        resources.food  = Math.max(0, resources.food  - Math.floor(resources.food * .3));
        tribe.warmthNeed = Math.max(0, tribe.warmthNeed - 25);
        break;
      }

      case 'BLIZZARD': {
        // Massive warmth drain
        tribe.warmthNeed = Math.max(0, tribe.warmthNeed - 50);
        tribe.foodNeed   = Math.max(0, tribe.foodNeed   - 15);
        // Freeze some FERTILE/FOREST tiles temporarily
        let frozen = 0;
        for (const tile of world.tiles) {
          if ((tile.type === 'FERTILE' || tile.type === 'FOREST') && rng() < .25) {
            tile.originalType = tile.type;
            tile.type = 'SNOW';
            frozen++;
          }
        }
        msgs.push({ text: `Tribe warmth −50. ${frozen} tiles frozen over.`, type: 'danger' });

        // Schedule partial thaw in future turns (handled by world as passiveEvents)
        world._blizzardThaw = 3; // UI/world processor uses this
        break;
      }

      case 'LANDSLIDE': {
        // Pick a random column and convert a strip of tiles to ASH/ROCK
        const col   = Math.floor(rng() * world.width);
        const startY = Math.floor(rng() * world.height * .3);
        const length = 3 + Math.floor(rng() * 4);
        let destroyed = 0;

        for (let dy = 0; dy < length; dy++) {
          const y = startY + dy;
          if (y >= world.height) break;
          // Affect col and neighbours slightly
          for (let dx = -1; dx <= 1; dx++) {
            if (rng() < (dx === 0 ? .9 : .4)) {
              const x = col + dx;
              const tile = WorldGen.getTile(world, x, y);
              if (!tile || tile.type === 'PEAK') continue;
              if (tile.buildingId) {
                BuildingSystem.remove(buildings, tile.buildingId, world.tiles);
                destroyed++;
              }
              tile.type = 'ASH';
              tile.depleted = true;
              tile.depletedIn = 15;
            }
          }
        }
        msgs.push({ text: `Landslide buried a strip of terrain. ${destroyed} buildings lost.`, type: 'warn' });
        resources.stone = Math.min(resources.maxStone, resources.stone + 5); // debris = free stone
        break;
      }

      case 'HEATWAVE': {
        // Spoil a fraction of food, drain warmth (paradoxically: dehydration)
        const spoiled = Math.floor(resources.food * .35);
        resources.food = Math.max(0, resources.food - spoiled);
        tribe.foodNeed = Math.max(0, tribe.foodNeed - 20);
        msgs.push({ text: `${spoiled} food spoiled in the heat.`, type: 'warn' });
        break;
      }
    }

    return { messages: msgs };
  }

  /** Passive world processing per turn (e.g. blizzard thaw). */
  function processWorldPassive(world) {
    if (world._blizzardThaw > 0) {
      world._blizzardThaw--;
      if (world._blizzardThaw === 0) {
        // Thaw snow tiles that weren't originally snow
        for (const tile of world.tiles) {
          if (tile.type === 'SNOW' && tile.originalType && tile.originalType !== 'SNOW') {
            tile.type = tile.originalType;
          }
        }
      }
    }
  }

  /** Get current warning banner text (if pending event). */
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
