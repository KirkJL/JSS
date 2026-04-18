/**
 * MORALE SYSTEM
 * -------------
 * Morale now has visible gameplay impact:
 * - gather efficiency
 * - survival resilience
 * - comeback potential
 */
const MoraleSystem = (() => {
  const DEFAULT_MORALE = 65;
  const FESTIVAL_COST = { food: 20 };
  const FESTIVAL_BOOST = 25;
  const FESTIVAL_COOLDOWN = 10;

  function create() {
    return {
      morale: DEFAULT_MORALE,
      festivalCooldown: 0,
      lastEvent: '',
      lastEffects: '',
    };
  }

  function fromSave(data) {
    return {
      morale: data?.morale ?? DEFAULT_MORALE,
      festivalCooldown: data?.festivalCooldown ?? 0,
      lastEvent: data?.lastEvent ?? '',
      lastEffects: data?.lastEffects ?? '',
    };
  }

  function processTurn(moraleState, tribeResult, disasterHit, era, prevEra, buildingsProxy = null) {
    let delta = 0;
    delta += (50 - moraleState.morale) * 0.04;
    if (disasterHit) delta -= 15;
    if (tribeResult.deaths > 0) delta -= Math.min(12, tribeResult.deaths * 2);
    if (tribeResult.grew > 0) delta += Math.min(5, tribeResult.grew);
    if (era > prevEra) delta += 20;
    delta += Math.min(6, buildingsProxy?.getMoralePerTurn?.() || 0);

    moraleState.morale = Math.round(Math.max(0, Math.min(100, moraleState.morale + delta)));
    if (moraleState.festivalCooldown > 0) moraleState.festivalCooldown--;

    const gatherPct = Math.round((getGatherMultiplier(moraleState) - 1) * 100);
    const deathPct = Math.round((1 - getDeathMultiplier(moraleState)) * 100);
    moraleState.lastEffects = `${gatherPct >= 0 ? '+' : ''}${gatherPct}% gather · ${deathPct >= 0 ? '-' : '+'}${Math.abs(deathPct)}% death pressure`;
  }

  function holdFestival(moraleState, resources) {
    if (moraleState.festivalCooldown > 0) {
      return { ok: false, reason: `Festival cooldown: ${moraleState.festivalCooldown} turns` };
    }
    if (!ResourceSystem.canAfford(resources, FESTIVAL_COST)) {
      return { ok: false, reason: `Need ${FESTIVAL_COST.food} food to hold a festival` };
    }
    ResourceSystem.spend(resources, FESTIVAL_COST);
    moraleState.morale = Math.min(100, moraleState.morale + FESTIVAL_BOOST);
    moraleState.festivalCooldown = FESTIVAL_COOLDOWN;
    moraleState.lastEvent = 'Festival held! +' + FESTIVAL_BOOST + ' morale 🎉';
    return { ok: true };
  }

  function growthMultiplier(moraleState) {
    return 0.55 + (moraleState.morale / 100) * 1.05;
  }

  function decayMultiplier(moraleState) {
    return 1.32 - (moraleState.morale / 100) * 0.62;
  }

  function getGatherMultiplier(moraleState) {
    return 0.75 + (moraleState.morale / 100) * 0.6;
  }

  function getDeathMultiplier(moraleState) {
    return 1.15 - (moraleState.morale / 100) * 0.45;
  }

  function getMiracleChance(moraleState, miracleBoost = 0) {
    return Math.max(0.03, Math.min(0.45, 0.06 + moraleState.morale / 500 + miracleBoost));
  }

  function getLabel(morale) {
    if (morale >= 80) return '😄 Jubilant';
    if (morale >= 60) return '🙂 Content';
    if (morale >= 40) return '😐 Uneasy';
    if (morale >= 20) return '😟 Miserable';
    return '😡 Restless';
  }

  return {
    create,
    fromSave,
    processTurn,
    holdFestival,
    growthMultiplier,
    decayMultiplier,
    getGatherMultiplier,
    getDeathMultiplier,
    getMiracleChance,
    getLabel,
  };
})();
