/**
 * TRIBE SYSTEM
 * ------------
 * Population, needs, deaths, growth, and comeback logic.
 */
const TribeSystem = (() => {
  const STARVE_THRESHOLD = 3;
  const FREEZE_THRESHOLD = 2;
  const UNSHELTER_THRESHOLD = 4;
  const DEATH_RATE = 0.20;
  const GROWTH_RATE = 0.08;
  const STARTING_POP = 8;

  let growthAccumulator = 0;

  const NEED_DECAY = { food: 15, shelter: 8, warmth: 10 };

  function create() {
    return {
      population: STARTING_POP,
      foodNeed: 70,
      shelterNeed: 60,
      warmthNeed: 80,
      starveTimer: 0,
      freezeTimer: 0,
      unshelterTimer: 0,
      deathsThisTurn: 0,
      growthThisTurn: 0,
      causeOfDeath: '',
    };
  }

  function processTurn(tribe, resources, buildings, season, disasterActive, moraleMultipliers) {
    const mGrowth = moraleMultipliers?.growth ?? 1.0;
    const mDecay = moraleMultipliers?.decay ?? 1.0;
    const deathMult = moraleMultipliers?.death ?? 1.0;
    const msgs = [];

    tribe.deathsThisTurn = 0;
    tribe.growthThisTurn = 0;
    tribe.causeOfDeath = '';

    const winterMult = (season === 3 ? 1.6 : 1.0) * mDecay;

    const foodConsumed = Math.ceil(tribe.population * 0.5);
    if (resources.food >= foodConsumed) {
      resources.food -= foodConsumed;
      tribe.foodNeed = Math.min(100, tribe.foodNeed + 10);
      tribe.starveTimer = 0;
    } else {
      resources.food = 0;
      tribe.foodNeed = Math.max(0, tribe.foodNeed - NEED_DECAY.food);
    }

    const shelterCap = buildings.getShelterCapacity();
    const shelterRatio = tribe.population > 0 ? Math.min(1, shelterCap / tribe.population) : 1;
    tribe.shelterNeed = Math.round(Math.max(0, Math.min(100,
      tribe.shelterNeed + (shelterRatio > 0.7 ? 12 : -NEED_DECAY.shelter)
    )));

    const warmthBonus = buildings.getWarmthBonus();
    const warmthDecay = disasterActive ? NEED_DECAY.warmth * 2.5 : NEED_DECAY.warmth * winterMult;
    tribe.warmthNeed = Math.round(Math.max(0, Math.min(100,
      tribe.warmthNeed - warmthDecay + warmthBonus
    )));

    tribe.starveTimer = tribe.foodNeed < 20 ? tribe.starveTimer + 1 : 0;
    tribe.unshelterTimer = tribe.shelterNeed < 20 ? tribe.unshelterTimer + 1 : 0;
    tribe.freezeTimer = tribe.warmthNeed < 20 ? tribe.freezeTimer + 1 : 0;

    let deaths = 0;
    let cause = '';

    if (tribe.starveTimer > STARVE_THRESHOLD) {
      const d = Math.max(1, Math.floor(tribe.population * DEATH_RATE * deathMult));
      deaths += d;
      cause = cause || 'Starvation';
      msgs.push({ text: `${d} starved to death 💀`, type: 'danger' });
    }
    if (tribe.freezeTimer > FREEZE_THRESHOLD) {
      const d = Math.max(1, Math.floor(tribe.population * DEATH_RATE * 1.5 * deathMult));
      deaths += d;
      cause = cause || 'Freezing';
      msgs.push({ text: `${d} froze in the night ❄️`, type: 'danger' });
    }
    if (tribe.unshelterTimer > UNSHELTER_THRESHOLD) {
      const d = Math.max(1, Math.floor(tribe.population * DEATH_RATE * 0.5 * deathMult));
      deaths += d;
      cause = cause || 'Exposure';
      msgs.push({ text: `${d} perished from exposure 🌧️`, type: 'warn' });
    }

    deaths = Math.min(deaths, Math.max(0, tribe.population - 1));
    tribe.population -= deaths;
    tribe.deathsThisTurn = deaths;

    if (tribe.foodNeed >= 40 && tribe.shelterNeed >= 40 && tribe.warmthNeed >= 40) {
      growthAccumulator += tribe.population * GROWTH_RATE * mGrowth;
      const growth = Math.floor(growthAccumulator);
      if (growth >= 1) {
        growthAccumulator -= growth;
        tribe.population += growth;
        tribe.growthThisTurn = growth;
        msgs.push({ text: `+${growth} joined the tribe 🌱`, type: 'good' });
      }
    } else {
      growthAccumulator = Math.max(0, growthAccumulator - 0.1);
    }

    const gameOver = tribe.population <= 0;
    if (gameOver) {
      tribe.population = 0;
      tribe.causeOfDeath = cause || deriveCause(tribe);
    } else if (deaths > 0) {
      tribe.causeOfDeath = cause || '';
    }

    return { deaths, grew: tribe.growthThisTurn, messages: msgs, gameOver, cause: tribe.causeOfDeath || cause };
  }

  function deriveCause(tribe) {
    const scores = [
      ['Starvation', tribe.foodNeed],
      ['Exposure', tribe.shelterNeed],
      ['Freezing', tribe.warmthNeed],
    ].sort((a, b) => a[1] - b[1]);
    return scores[0][0];
  }

  function fromSave(data) {
    growthAccumulator = Number(data?.growthAccumulator) || 0;
    return {
      population: Number(data?.population) || STARTING_POP,
      foodNeed: Number(data?.foodNeed) || 70,
      shelterNeed: Number(data?.shelterNeed) || 60,
      warmthNeed: Number(data?.warmthNeed) || 80,
      starveTimer: Number(data?.starveTimer) || 0,
      freezeTimer: Number(data?.freezeTimer) || 0,
      unshelterTimer: Number(data?.unshelterTimer) || 0,
      deathsThisTurn: 0,
      growthThisTurn: 0,
      causeOfDeath: data?.causeOfDeath || '',
    };
  }

  function getAccumulator() { return growthAccumulator; }

  return { create, processTurn, fromSave, getAccumulator, NEED_DECAY };
})();
