/**
 * LEADERBOARD CLIENT
 * ------------------
 * Keeps compatibility with the existing worker while sending richer stats.
 */
const LeaderboardSystem = (() => {
  const WORKER_URL = 'https://jss-worker.kirkjlemon.workers.dev';
  let lastScores = [];
  let submitPending = false;

  function submitScore(stats, onResult) {
    if (submitPending) return;
    submitPending = true;
    fetch(WORKER_URL + '/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: stats.name || 'Survivor',
        days: stats.days,
        seed: stats.seed,
        era: stats.era,
        populationPeak: stats.populationPeak || 0,
        comebackScore: stats.comebackScore || 0,
        strategy: stats.strategy || 'balanced',
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
