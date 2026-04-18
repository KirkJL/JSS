/**
 * MERCHANT SYSTEM
 * ---------------
 * Better trades, morale synergy, special offers, and meaningful visit moments.
 */
const MerchantSystem = (() => {
  const VISIT_INTERVAL_BASE = 23;
  const MERCHANT_DURATION = 4;

  function generateTrades(resources, rng, era, moraleState, merchantBonus = 0) {
    const morale = moraleState?.morale || 50;
    const trades = [];
    const goodMood = morale >= 70;
    const bonus = goodMood ? 2 : 0;

    const templates = [
      { type: 'standard', give: 'wood', giveAmt: 8, receive: 'food', receiveAmt: 12 + bonus },
      { type: 'standard', give: 'stone', giveAmt: 6, receive: 'food', receiveAmt: 10 + bonus },
      { type: 'standard', give: 'food', giveAmt: 10, receive: 'wood', receiveAmt: 8 + bonus },
      { type: 'standard', give: 'food', giveAmt: 10, receive: 'stone', receiveAmt: 7 + bonus },
      { type: 'standard', give: 'wood', giveAmt: 10, receive: 'stone', receiveAmt: 8 + bonus },
      { type: 'standard', give: 'stone', giveAmt: 8, receive: 'wood', receiveAmt: 10 + bonus },
      { type: 'survival', give: 'stone', giveAmt: 8, receive: 'food', receiveAmt: 16 + bonus, note: 'Emergency ration crate' },
      { type: 'survival', give: 'wood', giveAmt: 6, receive: 'food', receiveAmt: 14 + bonus, note: 'Dry goods for bad winters' },
    ];

    const shuffled = templates.slice().sort(() => rng() - 0.5);
    const count = 3 + (era >= 1 ? 1 : 0) + merchantBonus;
    for (let i = 0; i < Math.min(count, shuffled.length); i++) {
      trades.push({ ...shuffled[i], id: i + 1 });
    }

    if (era >= 1 || morale >= 75) {
      trades.push({
        id: 100,
        type: 'special',
        give: 'food',
        giveAmt: 14,
        receive: 'morale',
        receiveAmt: 18,
        note: 'Storytellers, music, and rest for the tribe',
      });
    }

    if (era >= 2 || merchantBonus > 0) {
      trades.push({
        id: 101,
        type: 'special',
        give: 'stone',
        giveAmt: 14,
        receive: 'blueprint',
        receiveAmt: 1,
        unlockBuildingId: 'SHRINE',
        note: 'A rare blueprint from the lowlands',
      });
    }

    return trades;
  }

  function createState() {
    return {
      active: false,
      turnsLeft: 0,
      trades: [],
      nextVisitIn: VISIT_INTERVAL_BASE,
      totalVisits: 0,
      bestTradeCount: 0,
    };
  }

  function fromSave(data) {
    return {
      active: data?.active ?? false,
      turnsLeft: data?.turnsLeft ?? 0,
      trades: data?.trades ?? [],
      nextVisitIn: data?.nextVisitIn ?? VISIT_INTERVAL_BASE,
      totalVisits: data?.totalVisits ?? 0,
      bestTradeCount: data?.bestTradeCount ?? 0,
    };
  }

  function processTurn(merchantState, resources, era, rng, moraleState = null, buildingsProxy = null) {
    const msgs = [];

    if (merchantState.active) {
      merchantState.turnsLeft--;
      if (merchantState.turnsLeft <= 0) {
        merchantState.active = false;
        merchantState.trades = [];
        msgs.push({ text: '🐪 The merchant has departed.', type: 'info' });
      }
      return msgs;
    }

    merchantState.nextVisitIn--;
    if (merchantState.nextVisitIn > 0) return msgs;

    const bonus = buildingsProxy?.getMerchantBonus?.() || 0;
    merchantState.active = true;
    merchantState.turnsLeft = MERCHANT_DURATION + bonus;
    merchantState.trades = generateTrades(resources, rng, era, moraleState, bonus);
    merchantState.totalVisits++;
    merchantState.nextVisitIn = Math.max(10, VISIT_INTERVAL_BASE - era * 4 - bonus * 2);

    msgs.push({ text: '🐪 A merchant has arrived with strong offers. Check the TRADE tab.', type: 'good', banner: true });
    return msgs;
  }

  function executeTrade(merchantState, tradeId, resources, moraleState, gameState = null) {
    if (!merchantState.active) return { ok: false, reason: 'No merchant present' };
    const trade = merchantState.trades.find(t => t.id === tradeId);
    if (!trade) return { ok: false, reason: 'Invalid trade' };

    const cost = trade.give === 'morale' ? null : { [trade.give]: trade.giveAmt };
    if (cost && !ResourceSystem.canAfford(resources, cost)) return { ok: false, reason: `Need ${trade.giveAmt} ${trade.give}` };

    if (cost) ResourceSystem.spend(resources, cost);

    if (trade.receive === 'morale') {
      moraleState.morale = Math.min(100, moraleState.morale + trade.receiveAmt);
      moraleState.lastEvent = `Merchant boosted morale by ${trade.receiveAmt}`;
    } else if (trade.receive === 'blueprint') {
      if (gameState) {
        gameState.merchantBlueprints = gameState.merchantBlueprints || [];
        if (!gameState.merchantBlueprints.includes(trade.unlockBuildingId)) {
          gameState.merchantBlueprints.push(trade.unlockBuildingId);
        }
      }
    } else {
      const maxKey = 'max' + trade.receive.charAt(0).toUpperCase() + trade.receive.slice(1);
      resources[trade.receive] = Math.min(resources[maxKey], resources[trade.receive] + trade.receiveAmt);
    }

    if (moraleState) moraleState.morale = Math.min(100, moraleState.morale + 5);
    merchantState.bestTradeCount = Math.max(merchantState.bestTradeCount, merchantState.trades.length);
    merchantState.trades = merchantState.trades.filter(t => t.id !== tradeId);

    return { ok: true, gained: { [trade.receive]: trade.receiveAmt }, trade };
  }

  const RESOURCE_EMOJI = { food: '🌿', wood: '🌲', stone: '🪨', morale: '💛', blueprint: '📜' };

  function getTradeLabel(trade) {
    const left = `Give ${trade.giveAmt}${RESOURCE_EMOJI[trade.give] || ''}`;
    const right = `Get ${trade.receiveAmt}${RESOURCE_EMOJI[trade.receive] || ''}`;
    const note = trade.note ? ` · ${trade.note}` : '';
    return `${left} → ${right}${note}`;
  }

  return {
    createState,
    fromSave,
    processTurn,
    executeTrade,
    getTradeLabel,
    RESOURCE_EMOJI,
  };
})();
