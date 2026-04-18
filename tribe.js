/**
 * TRIBE SYSTEM
 * ------------
 * Manages the player's tribe: population count, three core needs
 * (food, shelter, warmth), and the growth/death simulation each turn.
 *
 * Needs are tracked as 0–100 percentages.
 * Failing a need for too many consecutive turns causes death events.
 *
 * To extend:
 *   - Add a "morale" need for era unlock bonuses
 *   - Add specialist roles (hunter, builder, scholar)
 *   - Add disease mechanic tied to overcrowding
 */

const TribeSystem = (() => {

  // ---- Constants ----
  // Turns before starvation / freezing / exposure kills members
  const STARVE_THRESHOLD  = 3;   // turns without food before deaths start
  const FREEZE_THRESHOLD  = 2;   // turns without warmth
  const UNSHELTER_THRESHOLD = 4; // turns without shelter
  const DEATH_RATE        = .20; // fraction of population that dies per over-threshold turn
  const GROWTH_RATE       = .06; // fraction that grows per turn when ALL needs met
  const STARTING_POP      = 8;

  // Need decay per turn (how much each need drops per END TURN)
  // Modified by season and events
  const NEED_DECAY = {
    food:    15, // food is consumed every turn
    shelter: 8,  // shelter need builds slowly
    warmth:  10, // warmth matters more in winter
  };

  /** Create a fresh tribe state. */
  function create() {
    return {
      population:      STARTING_POP,
      // Needs: 0 = critical, 100 = fully met
      foodNeed:        70,
      shelterNeed:     60,
      warmthNeed:      80,
      // Consecutive-failure counters
      starveTimer:     0,
      freezeTimer:     0,
      unshelterTimer:  0,
      // Stat history for UI
      deathsThisTurn:  0,
      growthThisTurn:  0,
    };
  }

  /**
   * Process tribe needs at the end of a turn.
   *
   * @param {object} tribe      - tribe state (mutated in place)
   * @param {object} resources  - current resource pool
   * @param {object} buildings  - building registry (for shelter count)
   * @param {number} season     - 0=Spring, 1=Summer, 2=Autumn, 3=Winter
   * @param {boolean} disasterActive - true if a freeze/storm disaster is happening
   * @returns {object} { died, grew, messages }  – summary for UI
   */
  function processTurn(tribe, resources, buildings, season, disasterActive) {
    const msgs = [];
    tribe.deathsThisTurn = 0;
    tribe.growthThisTurn = 0;

    // ---- 1. Decay needs ----
    const winterMult = season === 3 ? 1.6 : 1.0;

    // Food: consume from stockpile proportional to pop
    const foodConsumed = Math.ceil(tribe.population * .5); // half a food per person
    if (resources.food >= foodConsumed) {
      resources.food -= foodConsumed;
      tribe.foodNeed  = Math.min(100, tribe.foodNeed + 10);
      tribe.starveTimer = 0;
    } else {
      resources.food = 0;
      tribe.foodNeed = Math.max(0, tribe.foodNeed - NEED_DECAY.food);
    }

    // Shelter: based on ratio of sheltered pop
    const shelterCap = buildings.getShelterCapacity();
    const shelterRatio = tribe.population > 0
      ? Math.min(1, shelterCap / tribe.population)
      : 1;
    tribe.shelterNeed = Math.round(
      Math.max(0, Math.min(100,
        tribe.shelterNeed + (shelterRatio > .7 ? 12 : -NEED_DECAY.shelter)
      ))
    );

    // Warmth: drops faster in winter; buildings help
    const warmthBonus = buildings.getWarmthBonus();
    const warmthDecay = disasterActive
      ? NEED_DECAY.warmth * 2.5
      : NEED_DECAY.warmth * winterMult;
    tribe.warmthNeed = Math.round(
      Math.max(0, Math.min(100,
        tribe.warmthNeed - warmthDecay + warmthBonus
      ))
    );

    // ---- 2. Failure timers ----
    tribe.starveTimer    = tribe.foodNeed    < 20 ? tribe.starveTimer + 1 : 0;
    tribe.unshelterTimer = tribe.shelterNeed < 20 ? tribe.unshelterTimer + 1 : 0;
    tribe.freezeTimer    = tribe.warmthNeed  < 20 ? tribe.freezeTimer    + 1 : 0;

    // ---- 3. Deaths ----
    let deaths = 0;

    if (tribe.starveTimer > STARVE_THRESHOLD) {
      const d = Math.max(1, Math.floor(tribe.population * DEATH_RATE));
      deaths += d;
      msgs.push({ text: `${d} starved to death 💀`, type: 'danger' });
    }
    if (tribe.freezeTimer > FREEZE_THRESHOLD) {
      const d = Math.max(1, Math.floor(tribe.population * DEATH_RATE * 1.5));
      deaths += d;
      msgs.push({ text: `${d} froze in the night ❄️`, type: 'danger' });
    }
    if (tribe.unshelterTimer > UNSHELTER_THRESHOLD) {
      const d = Math.max(1, Math.floor(tribe.population * DEATH_RATE * .5));
      deaths += d;
      msgs.push({ text: `${d} perished from exposure 🌧️`, type: 'warn' });
    }

    deaths = Math.min(deaths, tribe.population - 1); // never go to 0 from needs (game over handled separately)
    tribe.population    -= deaths;
    tribe.deathsThisTurn = deaths;

    // ---- 4. Growth (if ALL needs are healthy) ----
    if (tribe.foodNeed >= 50 && tribe.shelterNeed >= 50 && tribe.warmthNeed >= 50) {
      const growth = Math.floor(tribe.population * GROWTH_RATE);
      if (growth > 0) {
        tribe.population    += growth;
        tribe.growthThisTurn = growth;
        if (growth > 0) msgs.push({ text: `+${growth} joined the tribe 🌱`, type: 'good' });
      }
    }

    // ---- 5. Check game over ----
    const gameOver = tribe.population <= 0;
    if (gameOver) tribe.population = 0;

    return { deaths, grew: tribe.growthThisTurn, messages: msgs, gameOver };
  }

  /** Restore tribe from saved data. */
  function fromSave(data) {
    return {
      population:      data.population,
      foodNeed:        data.foodNeed,
      shelterNeed:     data.shelterNeed,
      warmthNeed:      data.warmthNeed,
      starveTimer:     data.starveTimer,
      freezeTimer:     data.freezeTimer,
      unshelterTimer:  data.unshelterTimer,
      deathsThisTurn:  0,
      growthThisTurn:  0,
    };
  }

  return { create, processTurn, fromSave, NEED_DECAY };

})();
