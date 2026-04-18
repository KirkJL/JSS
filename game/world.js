/**
 * WORLD GENERATION
 * ----------------
 * Adds special fog-of-war reward tiles and keeps seeded generation deterministic.
 */
const WorldGen = (() => {
  const TILE_DEFS = {
    PEAK:    { id:'PEAK',    name:'Summit',       color:'#b0bec5', emoji:'🏔️', passable:false, gatherYield:{stone:1},       floodRisk:0,   snowRisk:1   },
    SNOW:    { id:'SNOW',    name:'Snowfield',    color:'#ecf0f1', emoji:'❄️', passable:true,  gatherYield:{},               floodRisk:0,   snowRisk:1   },
    ROCK:    { id:'ROCK',    name:'Rocky Slope',  color:'#78909c', emoji:'🪨', passable:true,  gatherYield:{stone:3},       floodRisk:0,   snowRisk:.3  },
    FOREST:  { id:'FOREST',  name:'Forest',       color:'#2e7d32', emoji:'🌲', passable:true,  gatherYield:{wood:3,food:1}, floodRisk:.2,  snowRisk:.1  },
    FERTILE: { id:'FERTILE', name:'Fertile Land', color:'#558b2f', emoji:'🌿', passable:true,  gatherYield:{food:4,wood:1}, floodRisk:.3,  snowRisk:.1  },
    WATER:   { id:'WATER',   name:'Water',        color:'#1565c0', emoji:'💧', passable:false, gatherYield:{food:1},        floodRisk:1,   snowRisk:0   },
    FLOODED: { id:'FLOODED', name:'Flooded',      color:'#0d47a1', emoji:'🌊', passable:false, gatherYield:{},              floodRisk:1,   snowRisk:0   },
    ASH:     { id:'ASH',     name:'Ash/Ruin',     color:'#424242', emoji:'🔥', passable:true,  gatherYield:{stone:1},       floodRisk:0,   snowRisk:0   },
  };

  const SPECIALS = {
    cache: { emoji: '📦', name: 'Supply Cache' },
    shrine: { emoji: '✨', name: 'Ancient Shrine' },
    ruins: { emoji: '🏛️', name: 'Ancient Ruins' },
    survivors: { emoji: '🧍', name: 'Lost Survivors' },
  };

  function makePRNG(seed) {
    let s = seed >>> 0 || 0x6d2b79f5;
    return function() {
      s += 0x6d2b79f5;
      let z = s;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
  }

  function parseSeed(str) {
    if (!str) return Math.floor(Math.random() * 0xFFFFFF);
    const n = parseInt(str, 10);
    if (!isNaN(n)) return n >>> 0;
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function valueNoise2D(rng, width, height, scale) {
    const gw = Math.ceil(width / scale) + 2;
    const gh = Math.ceil(height / scale) + 2;
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = rng();

    function lerp(a, b, t) { return a + (b - a) * t; }
    function smoothstep(t) { return t * t * (3 - 2 * t); }

    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const gx = x / scale;
        const gy = y / scale;
        const ix = Math.floor(gx), iy = Math.floor(gy);
        const fx = smoothstep(gx - ix), fy = smoothstep(gy - iy);
        const v00 = grid[iy * gw + ix];
        const v10 = grid[iy * gw + ix + 1];
        const v01 = grid[(iy + 1) * gw + ix];
        const v11 = grid[(iy + 1) * gw + ix + 1];
        out[y * width + x] = lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
      }
    }
    return out;
  }

  function heightMap(rng, width, height) {
    const noise1 = valueNoise2D(rng, width, height, 4);
    const noise2 = valueNoise2D(rng, width, height, 8);

    const cx = width / 2 + (rng() - 0.5) * width * 0.2;
    const cy = height / 2 + (rng() - 0.5) * height * 0.2;

    const map = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = (x - cx) / (width * 0.5);
        const dy = (y - cy) / (height * 0.5);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radial = Math.max(0, 1 - dist);
        const idx = y * width + x;
        map[idx] = radial * 0.55 + noise1[idx] * 0.3 + noise2[idx] * 0.15;
      }
    }
    return map;
  }

  function generate(seedStr) {
    const numericSeed = parseSeed(seedStr);
    const rng = makePRNG(numericSeed);
    const WIDTH = 18;
    const HEIGHT = 22;
    const hmap = heightMap(rng, WIDTH, HEIGHT);
    const moisture = valueNoise2D(rng, WIDTH, HEIGHT, 5);
    const tiles = [];

    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const idx = y * WIDTH + x;
        const h = hmap[idx];
        const m = moisture[idx];
        let type;
        if (h > 0.75) type = 'PEAK';
        else if (h > 0.60) type = rng() < 0.5 ? 'SNOW' : 'ROCK';
        else if (h > 0.45) type = rng() < 0.3 ? 'ROCK' : (m > 0.55 ? 'FOREST' : 'ROCK');
        else if (h > 0.30) {
          if (m > 0.65) type = 'WATER';
          else if (m > 0.45) type = 'FERTILE';
          else type = 'FOREST';
        } else type = 'PEAK';

        const passable = TILE_DEFS[type].passable;
        let special = null;
        if (passable && type !== 'SNOW' && type !== 'WATER' && rng() < 0.075) {
          const candidates = ['cache', 'shrine', 'ruins', 'survivors'];
          special = candidates[Math.floor(rng() * candidates.length)];
        }

        tiles.push({
          x, y, type,
          height: h,
          moisture: m,
          depleted: false,
          depletedIn: 0,
          buildingId: null,
          flooded: false,
          originalType: type,
          special,
          specialClaimed: false,
        });
      }
    }

    return { tiles, width: WIDTH, height: HEIGHT, seed: String(numericSeed), numericSeed };
  }

  function findStartTile(world) {
    const cx = Math.floor(world.width / 2);
    const cy = Math.floor(world.height / 2);
    for (let r = 0; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
          const tile = world.tiles[y * world.width + x];
          const def = TILE_DEFS[tile.type];
          if (def.passable && tile.type !== 'SNOW' && tile.type !== 'WATER') return tile;
        }
      }
    }
    return world.tiles.find(t => TILE_DEFS[t.type].passable) || world.tiles[0];
  }

  function getTile(world, x, y) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null;
    return world.tiles[y * world.width + x];
  }

  function getNeighbours(world, tile) {
    const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
    return dirs.map(([dx,dy]) => getTile(world, tile.x + dx, tile.y + dy)).filter(Boolean);
  }

  return { TILE_DEFS, SPECIALS, generate, getTile, getNeighbours, findStartTile, parseSeed, makePRNG };
})();
