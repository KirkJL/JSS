/**
 * WORLD GENERATION
 * ----------------
 * Generates a procedural mountain map using a seeded PRNG and
 * layered noise to create varied terrain.
 *
 * Tile types and their meaning:
 *   PEAK    – high summit, dangerous, mostly impassable
 *   ROCK    – buildable but barren, yields stone
 *   FOREST  – yields wood, some shelter naturally
 *   FERTILE – best farming, food gathering
 *   WATER   – source tile, impassable, flood risk
 *   SNOW    – extreme cold zone, dangerous in winter
 *
 * To extend: add new tile types here and in TILE_DEFS,
 * then update the noise thresholds in generate().
 */

const WorldGen = (() => {

  // ---- Tile type definitions ----
  // Each entry: { id, name, color, emoji, passable, gatherYield, floodRisk }
  const TILE_DEFS = {
    PEAK:    { id:'PEAK',    name:'Summit',      color:'#b0bec5', emoji:'🏔️', passable:false, gatherYield:{stone:1},       floodRisk:0,   snowRisk:1   },
    SNOW:    { id:'SNOW',    name:'Snowfield',   color:'#ecf0f1', emoji:'❄️', passable:true,  gatherYield:{},               floodRisk:0,   snowRisk:1   },
    ROCK:    { id:'ROCK',    name:'Rocky Slope', color:'#78909c', emoji:'🪨', passable:true,  gatherYield:{stone:3},       floodRisk:0,   snowRisk:.3  },
    FOREST:  { id:'FOREST',  name:'Forest',      color:'#2e7d32', emoji:'🌲', passable:true,  gatherYield:{wood:3,food:1}, floodRisk:.2,  snowRisk:.1  },
    FERTILE: { id:'FERTILE', name:'Fertile Land',color:'#558b2f', emoji:'🌿', passable:true,  gatherYield:{food:4,wood:1}, floodRisk:.3,  snowRisk:.1  },
    WATER:   { id:'WATER',   name:'Water',       color:'#1565c0', emoji:'💧', passable:false, gatherYield:{food:1},        floodRisk:1,   snowRisk:0   },
    FLOODED: { id:'FLOODED', name:'Flooded',     color:'#0d47a1', emoji:'🌊', passable:false, gatherYield:{},              floodRisk:1,   snowRisk:0   },
    ASH:     { id:'ASH',     name:'Ash/Ruin',    color:'#424242', emoji:'🔥', passable:true,  gatherYield:{stone:1},       floodRisk:0,   snowRisk:0   },
  };

  // ---- Seeded PRNG (mulberry32) ----
  // Simple, fast, good distribution for a game
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

  /** Parse a seed string to a numeric seed. */
  function parseSeed(str) {
    if (!str || str.trim() === '') {
      return Math.floor(Math.random() * 0xFFFFFF);
    }
    // If numeric, use directly; otherwise hash the string
    const n = parseInt(str, 10);
    if (!isNaN(n)) return n >>> 0;
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /**
   * Very simple 2D value noise (no dependency on any library).
   * Interpolates between random values on a coarser grid.
   */
  function valueNoise2D(rng, width, height, scale) {
    const gw = Math.ceil(width  / scale) + 2;
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
        const v00 = grid[ iy      * gw + ix    ];
        const v10 = grid[ iy      * gw + ix + 1];
        const v01 = grid[(iy + 1) * gw + ix    ];
        const v11 = grid[(iy + 1) * gw + ix + 1];
        out[y * width + x] = lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
      }
    }
    return out;
  }

  /**
   * Generate a mountain-shaped height map.
   * Combines a radial mountain profile with noise for natural variation.
   */
  function heightMap(rng, width, height) {
    const noise1 = valueNoise2D(rng, width, height, 4);
    const noise2 = valueNoise2D(rng, width, height, 8);

    // Radial gradient (mountain shape): highest at centre
    const cx = width  / 2 + (rng() - .5) * width  * .2;
    const cy = height / 2 + (rng() - .5) * height * .2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    const map = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = (x - cx) / (width  * .5);
        const dy = (y - cy) / (height * .5);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radial = Math.max(0, 1 - dist);

        const idx = y * width + x;
        // Blend: 60% mountain shape, 25% large noise, 15% detail noise
        map[idx] = radial * .6 + noise1[idx] * .25 + noise2[idx] * .15;
      }
    }
    return map;
  }

  /**
   * Main generation function.
   * Returns { tiles, width, height, seed, numericSeed }
   *
   * tiles is a flat array of tile objects, indexed by y*width+x.
   */
  function generate(seedStr) {
    const numericSeed = parseSeed(seedStr);
    const rng = makePRNG(numericSeed);

    // Map size: 18×22 tiles (fits comfortably on mobile portrait)
    const WIDTH  = 18;
    const HEIGHT = 22;

    const hmap = heightMap(rng, WIDTH, HEIGHT);

    // Additional moisture map for water/fertile placement
    const moisture = valueNoise2D(rng, WIDTH, HEIGHT, 5);

    const tiles = [];

    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const idx = y * WIDTH + x;
        const h   = hmap[idx];
        const m   = moisture[idx];

        let type;

        // Height thresholds determine terrain
        if (h > .75) {
          type = 'PEAK';
        } else if (h > .60) {
          type = rng() < .5 ? 'SNOW' : 'ROCK';
        } else if (h > .45) {
          type = rng() < .3 ? 'ROCK' : (m > .55 ? 'FOREST' : 'ROCK');
        } else if (h > .30) {
          if (m > .65) type = 'WATER';
          else if (m > .45) type = 'FERTILE';
          else type = 'FOREST';
        } else {
          // Very low edge = cliff / impassable peak from below
          type = 'PEAK';
        }

        tiles.push({
          x, y, type,
          height: h,
          moisture: m,
          depleted: false,    // has this tile been fully gathered?
          depletedIn: 0,      // turns until regrowth
          buildingId: null,   // building placed on tile
          flooded: false,     // temp state for flood events
          originalType: type, // for disaster recovery
        });
      }
    }

    return {
      tiles,
      width:  WIDTH,
      height: HEIGHT,
      seed:   String(numericSeed),
      numericSeed,
    };
  }

  /** Find a good starting position: a passable, non-SNOW tile near the centre. */
  function findStartTile(world) {
    const cx = Math.floor(world.width  / 2);
    const cy = Math.floor(world.height / 2);

    // Spiral outward from centre until we find a passable tile
    for (let r = 0; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only the border of the spiral
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
          const tile = world.tiles[y * world.width + x];
          const def  = TILE_DEFS[tile.type];
          if (def.passable && tile.type !== 'SNOW' && tile.type !== 'WATER') return tile;
        }
      }
    }
    // Fallback
    return world.tiles.find(t => TILE_DEFS[t.type].passable) || world.tiles[0];
  }

  /** Get tile by (x, y) coords. Returns null if out-of-bounds. */
  function getTile(world, x, y) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null;
    return world.tiles[y * world.width + x];
  }

  /** Get all passable neighbours of a tile. */
  function getNeighbours(world, tile) {
    const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
    return dirs
      .map(([dx,dy]) => getTile(world, tile.x+dx, tile.y+dy))
      .filter(t => t && TILE_DEFS[t.type].passable);
  }

  return {
    TILE_DEFS,
    generate,
    findStartTile,
    getTile,
    getNeighbours,
    parseSeed,
  };

})();
