/**
 * ACHIEVEMENT SYSTEM
 * ------------------
 * Tracks one-time milestones. Achievements are checked each turn
 * and on specific game events (building placed, disaster survived, etc.)
 *
 * To extend: add new entries to ACHIEVEMENTS. The check function receives
 * the full game state and returns true when the achievement should unlock.
 */

const AchievementSystem = (() => {

  const ACHIEVEMENTS = [
    {
      id:    'FIRST_SHELTER',
      emoji: '🏠',
      name:  'Home is Where the Mountain Is',
      desc:  'Build your first Shelter.',
      check: (G) => Object.values(G.buildings.placed).some(b => b.defId === 'SHELTER'),
    },
    {
      id:    'SURVIVED_WINTER',
      emoji: '❄️',
      name:  'The Long Cold',
      desc:  'Survive your first Winter.',
      check: (G) => G.season === 0 && G.day > 90,  // back to Spring after a full cycle
    },
    {
      id:    'POP_20',
      emoji: '👥',
      name:  'Growing Tribe',
      desc:  'Reach a population of 20.',
      check: (G) => G.tribe.population >= 20,
    },
    {
      id:    'POP_50',
      emoji: '🏘️',
      name:  'Village on the Peak',
      desc:  'Reach a population of 50.',
      check: (G) => G.tribe.population >= 50,
    },
    {
      id:    'FIVE_BUILDINGS',
      emoji: '🏗️',
      name:  'Master Builder',
      desc:  'Place 5 buildings.',
      check: (G) => G.buildingsPlacedTotal >= 5,
    },
    {
      id:    'TEN_BUILDINGS',
      emoji: '🏙️',
      name:  'Settlement',
      desc:  'Place 10 buildings.',
      check: (G) => G.buildingsPlacedTotal >= 10,
    },
    {
      id:    'SURVIVED_FLOOD',
      emoji: '🌊',
      name:  'High and Dry',
      desc:  'Survive a Flash Flood.',
      check: (G) => G.events.history && G.events.history.some(e => e.defId === 'FLOOD'),
    },
    {
      id:    'SURVIVED_BLIZZARD',
      emoji: '🌨️',
      name:  'Frost Hardened',
      desc:  'Survive a Blizzard.',
      check: (G) => G.events.history && G.events.history.some(e => e.defId === 'BLIZZARD'),
    },
    {
      id:    'DAY_100',
      emoji: '📅',
      name:  'Century',
      desc:  'Survive 100 days.',
      check: (G) => G.day >= 100,
    },
    {
      id:    'DAY_200',
      emoji: '🌟',
      name:  'Mountain Legend',
      desc:  'Survive 200 days.',
      check: (G) => G.day >= 200,
    },
    {
      id:    'BRONZE_AGE',
      emoji: '🏛️',
      name:  'Age of Bronze',
      desc:  'Reach the Bronze Age.',
      check: (G) => G.era >= 1,
    },
    {
      id:    'IRON_AGE',
      emoji: '⚔️',
      name:  'Age of Iron',
      desc:  'Reach the Iron Age.',
      check: (G) => G.era >= 2,
    },
    {
      id:    'FIRST_FESTIVAL',
      emoji: '🎉',
      name:  'Celebration!',
      desc:  'Hold your first Festival.',
      check: (G) => G.morale && G.morale.festivalCooldown > 0,
    },
    {
      id:    'WATCHTOWER',
      emoji: '🗼',
      name:  'Eyes on the Storm',
      desc:  'Build a Watchtower.',
      check: (G) => Object.values(G.buildings.placed).some(b => b.defId === 'WATCHTOWER'),
    },
    {
      id:    'MERCHANT',
      emoji: '🐪',
      name:  'Silk Road (Gravel Edition)',
      desc:  'Successfully complete a trade.',
      check: (G) => G.merchant && G.merchant.totalVisits >= 1 && G.achievements._merchantTraded,
    },
    {
      id:    'HALF_MAP',
      emoji: '🗺️',
      name:  'Cartographer',
      desc:  'Explore half the map.',
      check: (G) => G.exploredTiles && G.world &&
             G.exploredTiles.length >= G.world.tiles.length / 2,
    },
  ];

  function createState() {
    return {
      unlocked: [],       // array of achievement IDs
      _merchantTraded: false,
    };
  }

  function fromSave(data) {
    return {
      unlocked:        data.unlocked        || [],
      _merchantTraded: data._merchantTraded || false,
    };
  }

  /**
   * Check all achievements. Returns array of newly unlocked ones.
   * Call once per turn from main endTurn().
   */
  function checkAll(G) {
    const newlyUnlocked = [];

    for (const ach of ACHIEVEMENTS) {
      if (G.achievements.unlocked.includes(ach.id)) continue;

      try {
        if (ach.check(G)) {
          G.achievements.unlocked.push(ach.id);
          newlyUnlocked.push(ach);
        }
      } catch (_) {
        // Silently skip broken checks
      }
    }

    return newlyUnlocked;
  }

  /** Get all achievements with unlocked status for the log UI. */
  function getAll(unlockedIds) {
    return ACHIEVEMENTS.map(a => ({
      ...a,
      unlocked: unlockedIds.includes(a.id),
    }));
  }

  return { createState, fromSave, checkAll, getAll, ACHIEVEMENTS };

})();
