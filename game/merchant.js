/**
 * MERCHANT SYSTEM
 * ---------------
 * Occasionally a merchant arrives offering 2–3 trades.
 * Each trade swaps surplus resources for deficit ones.
 * Merchant stays for 3 turns then leaves.
 *
 * Merchant frequency scales with era — appears more often in later eras.
 * Morale gets a small boost when a merchant is successfully traded with.
 *
 * To extend:
 *   - Add rare "special items" (blueprint for advanced building)
 *   - Add haggling mechanic based on morale
 */

const MerchantSystem = (() => {

  // How many turns between merchant visit checks
  const VISIT_INTERVAL_BASE = 25;
  const MERCHANT_DURATION   = 3;   // turns merchant stays

  /**
   * Generate a set of trades for the merchant based on current resource state.
   * Trades are biased toward giving the player what they're short on.
   */
  function generateTrades(resources, rng) {
    const trades = [];

    // Possible trade templates: { give, giveAmt, receive, receiveAmt }
    const templates = [
      { give: 'wood',  giveAmt: 8,  receive: 'food',  receiveAmt: 12 },
      { give: 'stone', giveAmt: 6,  receive: 'food',  receiveAmt: 10 },
      { give: 'food',  giveAmt: 10, receive: 'wood',  receiveAmt: 8  },
      { give: 'food',  giveAmt: 10, receive: 'stone', receiveAmt: 6  },
      { give: 'wood',  giveAmt: 10, receive: 'stone', receiveAmt: 8  },
      { give: 'stone', giveAmt: 8,  receive: 'wood',  receiveAmt: 10 },
    ];

    // Shuffle and pick 2–3
    const shuffled = templates.sort(() => rng() - 0.5);
    const count = rng() > 0.5 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      trades.push({ ...shuffled[i], id: i });
    }

    return trades;
  }

  function createState() {
    return {
      active:      false,
      turnsLeft:   0,
      trades:      [],      // array of trade objects
      nextVisitIn: VISIT_INTERVAL_BASE,
      totalVisits: 0,
    };
  }

  function fromSave(data) {
    return {
      active:      data.active      ?? false,
      turnsLeft:   data.turnsLeft   ?? 0,
      trades:      data.trades      ?? [],
      nextVisitIn: data.nextVisitIn ?? VISIT_INTERVAL_BASE,
      totalVisits: data.totalVisits ?? 0,
    };
  }

  /**
   * Process merchant state each turn.
   * Returns messages to log.
   */
  function processTurn(merchantState, resources, era, rng) {
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

    // Merchant arrives!
    merchantState.active      = true;
    merchantState.turnsLeft   = MERCHANT_DURATION;
    merchantState.trades      = generateTrades(resources, rng);
    merchantState.totalVisits++;
    // Interval shrinks with era (merchants more common in advanced times)
    merchantState.nextVisitIn = Math.max(12, VISIT_INTERVAL_BASE - era * 4);

    msgs.push({ text: '🐪 A merchant has arrived! Check the TRADE tab.', type: 'good', banner: true });
    return msgs;
  }

  /**
   * Execute a trade by index. Returns { ok, reason, gained }.
   */
  function executeTrade(merchantState, tradeId, resources, moraleState) {
    if (!merchantState.active) return { ok: false, reason: 'No merchant present' };

    const trade = merchantState.trades.find(t => t.id === tradeId);
    if (!trade) return { ok: false, reason: 'Invalid trade' };

    const cost = { [trade.give]: trade.giveAmt };
    if (!ResourceSystem.canAfford(resources, cost))
      return { ok: false, reason: `Need ${trade.giveAmt} ${trade.give}` };

    ResourceSystem.spend(resources, cost);
    resources[trade.receive] = Math.min(
      resources['max' + trade.receive.charAt(0).toUpperCase() + trade.receive.slice(1)],
      resources[trade.receive] + trade.receiveAmt
    );

    // Small morale boost from successful trade
    if (moraleState) moraleState.morale = Math.min(100, moraleState.morale + 5);

    // Remove this trade (each can only be done once per visit)
    merchantState.trades = merchantState.trades.filter(t => t.id !== tradeId);

    return {
      ok: true,
      gained: { [trade.receive]: trade.receiveAmt },
    };
  }

  const RESOURCE_EMOJI = { food: '🌿', wood: '🌲', stone: '🪨' };

  function getTradeLabel(trade) {
    return `Give ${trade.giveAmt}${RESOURCE_EMOJI[trade.give]} → Get ${trade.receiveAmt}${RESOURCE_EMOJI[trade.receive]}`;
  }

  return {
    createState, fromSave, processTurn, executeTrade, getTradeLabel, RESOURCE_EMOJI,
  };

})();
