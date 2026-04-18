/**
 * LEADERBOARD CLIENT
 * ------------------
 * Handles submitting scores to and fetching scores from the
 * Cloudflare Worker leaderboard.
 *
 * Set WORKER_URL to your deployed Worker URL after running `wrangler deploy`.
 */

const LeaderboardSystem = (() => {

  // ⚠️  CHANGE THIS to your deployed Worker URL after `wrangler deploy`
  const WORKER_URL = 'jss-worker.kirkjlemon.workers.dev';

  let lastScores   = [];
  let submitPending = false;

  /**
   * Submit a score. Fires-and-forgets — won't block game over screen.
   * @param {object} stats  { name, days, seed, era }
   * @param {function} onResult  callback({ ok, rank, error })
   */
  function submitScore(stats, onResult) {
    if (submitPending) return;
    submitPending = true;

    fetch(WORKER_URL + '/leaderboard', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name: stats.name || 'Survivor',
        days: stats.days,
        seed: stats.seed,
        era:  stats.era,
      }),
    })
    .then(r => r.json())
    .then(data => {
      submitPending = false;
      if (onResult) onResult({ ok: true, rank: data.rank });
    })
    .catch(err => {
      submitPending = false;
      console.warn('[Leaderboard] Submit failed:', err.message);
      if (onResult) onResult({ ok: false, error: err.message });
    });
  }

  /**
   * Fetch the current top 20. Returns a promise resolving to the array.
   */
  function fetchScores() {
    return fetch(WORKER_URL + '/leaderboard')
      .then(r => r.json())
      .then(data => {
        lastScores = Array.isArray(data) ? data : [];
        return lastScores;
      })
      .catch(err => {
        console.warn('[Leaderboard] Fetch failed:', err.message);
        return [];
      });
  }

  function getLastScores() { return lastScores; }

  return { submitScore, fetchScores, getLastScores };

})();
