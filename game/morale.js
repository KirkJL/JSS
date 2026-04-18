/**
 * MORALE SYSTEM
 * -------------
 * Tracks tribe morale (0–100). Morale acts as a multiplier on growth rate
 * and decay rate for needs. High morale = faster growth, slower decay.
 * Low morale = slower growth, faster decay, eventually causes unrest deaths.
 *
 * Morale is affected by:
 *   - Disasters    → big drop
 *   - Deaths       → moderate drop
 *   - Growth       → small boost
 *   - Festivals    → large boost (player-triggered, costs food)
 *   - Era advances → boost
 *   - Merchants    → small boost
 *
 * To extend: add morale-triggered "unrest" events at very low morale.
 */

const MoraleSystem = (() => {

  const DEFAULT_MORALE  = 65;
  const FESTIVAL_COST   = { food: 20 };  // cost to hold a festival
  const FESTIVAL_BOOST  = 25;
  const FESTIVAL_COOLDOWN = 10;          // turns between festivals

  function create() {
    return {
      morale:           DEFAULT_MORALE,
      festivalCooldown: 0,
      lastEvent:        '',   // text for UI
    };
  }

  function fromSave(data) {
    return {
      morale:           data.morale           ?? DEFAULT_MORALE,
      festivalCooldown: data.festivalCooldown ?? 0,
      lastEvent:        data.lastEvent        ?? '',
    };
  }

  /**
   * Apply morale changes at end of turn.
   * @param {object} moraleState  - mutated in place
   * @param {object} tribeResult  - { deaths, grew } from TribeSystem
   * @param {boolean} disasterHit - true if a disaster fired this turn
   * @param {number}  era         - current era index
   * @param {number}  prevEra     - era at start of turn
   */
  function processTurn(moraleState, tribeResult, disasterHit, era, prevEra) {
    let delta = 0;

    // Natural slow drift toward 50 (regression to mean)
    delta += (50 - moraleState.morale) * 0.04;

    if (disasterHit)           delta -= 15;
    if (tribeResult.deaths > 0) delta -= Math.min(12, tribeResult.deaths * 2);
    if (tribeResult.grew   > 0) delta += Math.min(5,  tribeResult.grew);
    if (era > prevEra)          delta += 20;

    moraleState.morale = Math.round(Math.max(0, Math.min(100, moraleState.morale + delta)));

    if (moraleState.festivalCooldown > 0) moraleState.festivalCooldown--;
  }

  /**
   * Hold a festival. Returns { ok, reason }.
   * Costs food, boosts morale, has a cooldown.
   */
  function holdFestival(moraleState, resources) {
    if (moraleState.festivalCooldown > 0)
      return { ok: false, reason: `Festival cooldown: ${moraleState.festivalCooldown} turns` };
    if (!ResourceSystem.canAfford(resources, FESTIVAL_COST))
      return { ok: false, reason: `Need ${FESTIVAL_COST.food} food to hold a festival` };

    ResourceSystem.spend(resources, FESTIVAL_COST);
    moraleState.morale = Math.min(100, moraleState.morale + FESTIVAL_BOOST);
    moraleState.festivalCooldown = FESTIVAL_COOLDOWN;
    moraleState.lastEvent = 'Festival held! +' + FESTIVAL_BOOST + ' morale 🎉';
    return { ok: true };
  }

  /**
   * Morale multiplier for growth rate.
   * 1.5× at 100 morale, 0.5× at 0 morale.
   */
  function growthMultiplier(moraleState) {
    return 0.5 + (moraleState.morale / 100);
  }

  /**
   * Morale multiplier for need decay (inverted — high morale = less decay).
   * 0.7× at 100 morale, 1.3× at 0 morale.
   */
  function decayMultiplier(moraleState) {
    return 1.3 - (moraleState.morale / 100) * 0.6;
  }

  function getLabel(morale) {
    if (morale >= 80) return '😄 Jubilant';
    if (morale >= 60) return '🙂 Content';
    if (morale >= 40) return '😐 Uneasy';
    if (morale >= 20) return '😟 Miserable';
    return '😡 Restless';
  }

  return {
    create, fromSave, processTurn, holdFestival,
    growthMultiplier, decayMultiplier, getLabel,
    FESTIVAL_COST,
  };

})();
