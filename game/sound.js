/**
 * SOUND SYSTEM
 * ------------
 * Procedural sound effects using Web Audio API.
 * Zero assets — all sounds synthesized from oscillators and noise.
 * Auto-initialises on first user interaction (browser autoplay policy).
 *
 * Sounds:
 *   gather   – soft pluck tone
 *   build    – satisfying thud + shimmer
 *   disaster – low rumble + alarm
 *   death    – descending minor chord
 *   growth   – ascending chime
 *   festival – bright fanfare arpeggio
 *   merchant – jingle bells-ish
 *   achievement – triumphant three-note rise
 *
 * To extend: add new entries to the play() switch statement.
 */

const SoundSystem = (() => {

  let ctx = null;
  let enabled = true;
  let masterGain = null;

  /** Lazy-init AudioContext on first interaction. */
  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.3;
      masterGain.connect(ctx.destination);
    } catch(e) {
      console.warn('[Sound] Web Audio not available:', e.message);
      enabled = false;
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // ---- Core synth helpers ----

  function osc(freq, type, startTime, duration, gainVal = 0.4, detune = 0) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    g.gain.setValueAtTime(gainVal, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    o.connect(g);
    g.connect(masterGain);
    o.start(startTime);
    o.stop(startTime + duration + 0.05);
  }

  function noise(startTime, duration, gainVal = 0.15, highpass = 800) {
    if (!ctx) return;
    const bufSize = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = highpass;

    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    src.start(startTime);
    src.stop(startTime + duration + 0.05);
  }

  // ---- Sound definitions ----

  function playGather() {
    if (!ctx) return;
    const t = ctx.currentTime;
    osc(440, 'triangle', t,       0.15, 0.3);
    osc(880, 'sine',     t + 0.05, 0.08, 0.15);
  }

  function playBuild() {
    if (!ctx) return;
    const t = ctx.currentTime;
    // Low thud
    osc(80, 'sine', t, 0.25, 0.5);
    noise(t, 0.12, 0.2, 200);
    // Shimmer
    osc(1200, 'sine', t + 0.1, 0.2, 0.1);
    osc(1600, 'sine', t + 0.15, 0.15, 0.08);
  }

  function playDisaster() {
    if (!ctx) return;
    const t = ctx.currentTime;
    // Low rumble
    osc(55,  'sawtooth', t,       0.6, 0.4);
    osc(50,  'sawtooth', t + 0.1, 0.5, 0.35, 10);
    noise(t, 0.7, 0.3, 100);
    // Alarm pulse
    for (let i = 0; i < 3; i++) {
      osc(880, 'square', t + 0.3 + i * 0.2, 0.15, 0.15);
    }
  }

  function playDeath() {
    if (!ctx) return;
    const t = ctx.currentTime;
    // Descending minor chord
    const notes = [440, 370, 294, 220];
    notes.forEach((freq, i) => {
      osc(freq, 'sine', t + i * 0.1, 0.4, 0.2);
    });
  }

  function playGrowth() {
    if (!ctx) return;
    const t = ctx.currentTime;
    // Rising chime
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      osc(freq, 'triangle', t + i * 0.08, 0.2, 0.15);
    });
  }

  function playFestival() {
    if (!ctx) return;
    const t = ctx.currentTime;
    // Bright arpeggio C major
    const notes = [523, 659, 784, 1047, 784, 659, 523];
    notes.forEach((freq, i) => {
      osc(freq, 'triangle', t + i * 0.07, 0.12, 0.2);
    });
    noise(t + 0.1, 0.4, 0.05, 2000);
  }

  function playMerchant() {
    if (!ctx) return;
    const t = ctx.currentTime;
    // Jingle-ish notes
    const notes = [659, 784, 659, 523];
    notes.forEach((freq, i) => {
      osc(freq, 'triangle', t + i * 0.1, 0.15, 0.2);
    });
  }

  function playAchievement() {
    if (!ctx) return;
    const t = ctx.currentTime;
    // Triumphant three-note rise + sustain
    osc(523,  'triangle', t,       0.4, 0.3);
    osc(659,  'triangle', t + 0.12, 0.35, 0.3);
    osc(784,  'triangle', t + 0.24, 0.5, 0.35);
    osc(1047, 'sine',     t + 0.36, 0.8, 0.25);
    noise(t + 0.36, 0.3, 0.04, 3000);
  }

  function playEra() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [261, 329, 392, 523, 659, 784];
    notes.forEach((freq, i) => {
      osc(freq, 'triangle', t + i * 0.09, 0.3, 0.2);
    });
  }

  function playEndTurn() {
    if (!ctx) return;
    const t = ctx.currentTime;
    osc(300, 'sine', t, 0.08, 0.08);
  }

  /** Main play dispatcher. */
  function play(id) {
    if (!enabled) return;
    init();
    resume();
    try {
      switch(id) {
        case 'gather':      playGather();      break;
        case 'build':       playBuild();       break;
        case 'disaster':    playDisaster();    break;
        case 'death':       playDeath();       break;
        case 'growth':      playGrowth();      break;
        case 'festival':    playFestival();    break;
        case 'merchant':    playMerchant();    break;
        case 'achievement': playAchievement(); break;
        case 'era':         playEra();         break;
        case 'endturn':     playEndTurn();     break;
      }
    } catch(e) {
      console.warn('[Sound] playback error:', e.message);
    }
  }

  function setEnabled(val) { enabled = val; }
  function isEnabled() { return enabled; }

  return { init, play, setEnabled, isEnabled };

})();
