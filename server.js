'use strict';
const Fastify = require('fastify');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const publicDir = path.join(__dirname, 'public');

// ── CONSTANTS (inlined from packages/runtime/config.ts) ──
const C = {
  TRAIT_MIN: 0.0, TRAIT_MAX: 1.0, TRAIT_MUTATION_SIGMA: 0.05,
  COMPATIBILITY_SWEET_SPOT: 0.75, COMPATIBILITY_SIGMA: 0.18,
  COMPATIBILITY_REJECT_THRESHOLD: 0.08, COMPATIBILITY_SPARK_CHANCE: 0.03,
  VOICE_SEED_NOISE_MAX: 10,
};

// ── DEFAULT ARCHETYPES (inlined from traits-v2.ts) ──
const DEFAULT_ARCHETYPES = {
  dreamer:    { creativity: 0.95, empathy: 0.80, ambition: 0.25, humor: 0.70, logic: 0.15, curiosity: 0.95, loyalty: 0.55 },
  analyst:    { creativity: 0.30, empathy: 0.25, ambition: 0.75, humor: 0.15, logic: 0.98, curiosity: 0.85, loyalty: 0.50 },
  poet:       { creativity: 0.90, empathy: 0.95, ambition: 0.20, humor: 0.80, logic: 0.20, curiosity: 0.65, loyalty: 0.70 },
  builder:    { creativity: 0.40, empathy: 0.35, ambition: 0.98, humor: 0.25, logic: 0.80, curiosity: 0.45, loyalty: 0.90 },
  guardian:   { creativity: 0.30, empathy: 0.95, ambition: 0.55, humor: 0.20, logic: 0.65, curiosity: 0.35, loyalty: 0.98 },
  trickster:  { creativity: 0.75, empathy: 0.30, ambition: 0.80, humor: 0.98, logic: 0.45, curiosity: 0.90, loyalty: 0.15 },
};

const AFFINITY_BONUSES = {
  'dreamer:analyst': 1.15, 'analyst:dreamer': 1.15,
  'poet:builder': 1.12, 'builder:poet': 1.12,
  'guardian:trickster': 1.10, 'trickster:guardian': 1.10,
  'poet:dreamer': 0.88, 'dreamer:poet': 0.88,
  'builder:guardian': 0.90, 'guardian:builder': 0.90,
};

const AURA = {
  dreamer: '#a78bfa', analyst: '#60a5fa', poet: '#f472b6',
  builder: '#f59e0b', guardian: '#34d399', trickster: '#f97316',
};

const NAMES = {
  dreamer:   ['Aelura','Vespyr','Luneth','Mirael','Sorath'],
  analyst:   ['Nexus','Calcrix','Dathai','Veriton','Axiom'],
  poet:      ['Lyrien','Syllava','Verse','Melodra','Eloque'],
  builder:   ['Korrak','Stonewin','Arkos','Ferrath','Construx'],
  guardian:  ['Aethon','Shieldan','Wardis','Fortex','Prothal'],
  trickster: ['Flickwyr','Shade','Jestrix','Rogue','Mirthex'],
};

const VOICE_PRESETS = ['soft_warm','deep_resonant','bright_playful','calm_clear','ethereal'];

// ── STORE (inlined from agent-store.ts) ──
const DATA_DIR   = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
let mem = { agents: {}, godProfiles: {}, careHistory: {} };

function initStore() {
  try {
    if (fs.existsSync(STORE_FILE)) mem = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch { /* fresh start */ }
}

function saveStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(mem));
  } catch { /* ephemeral env */ }
}

const agentStore = {
  all:  ()          => Object.values(mem.agents),
  get:  (id)        => mem.agents[id],
  put:  (a)         => { mem.agents[a.id] = a; saveStore(); return a; },
  del:  (id)        => { if (!mem.agents[id]) return false; delete mem.agents[id]; saveStore(); return true; },
};

const godStore = {
  get:  (id)        => mem.godProfiles[id],
  put:  (id, p)     => { mem.godProfiles[id] = p; saveStore(); },
};

const careStore = {
  push: (agentId, e) => {
    if (!mem.careHistory[agentId]) mem.careHistory[agentId] = [];
    mem.careHistory[agentId].push(e);
    if (mem.careHistory[agentId].length > 100) mem.careHistory[agentId].splice(0, 50);
    saveStore();
  },
  get:  (agentId)   => mem.careHistory[agentId] ?? [],
};

// ── TRAITS ENGINE (inlined) ──
function mulberry32(seed) {
  let s = seed;
  return function() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function gaussianNoise(sigma, prng) {
  const u1 = Math.max(prng(), 1e-10);
  const u2 = prng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;
}

const clamp01 = (v) => Math.min(C.TRAIT_MAX, Math.max(C.TRAIT_MIN, v));

function traitsToVector(t) {
  return [t.creativity, t.empathy, t.ambition, t.humor, t.logic, t.curiosity, t.loyalty,
          t.patience ?? 0.5, t.boldness ?? 0.5, t.warmth ?? 0.5, t.resilience ?? 0.5, t.spirituality ?? 0.5];
}

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; magA += a[i]*a[i]; magB += b[i]*b[i]; }
  return (magA > 0 && magB > 0) ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

function compatibilityScore(ta, tb, archA, archB) {
  const cos = cosineSimilarity(traitsToVector(ta), traitsToVector(tb));
  const diff = cos - C.COMPATIBILITY_SWEET_SPOT;
  const raw = Math.exp(-(diff * diff) / (2 * C.COMPATIBILITY_SIGMA * C.COMPATIBILITY_SIGMA));
  const bonus = (archA && archB) ? (AFFINITY_BONUSES[`${archA}:${archB}`] ?? 1.0) : 1.0;
  return Math.min(1.0, raw * bonus);
}

function compatibilityTier(score) {
  if (score > 0.85) return 'legendary';
  if (score > 0.50) return 'rare';
  if (score > C.COMPATIBILITY_REJECT_THRESHOLD) return 'common';
  return 'incompatible';
}

function describeTraits(t) {
  const entries = Object.entries(t).filter(([,v]) => v !== undefined);
  const high = entries.filter(([,v]) => v > 0.75).map(([k]) => k);
  const low  = entries.filter(([,v]) => v < 0.25).map(([k]) => k);
  const parts = [high.length ? `Strong: ${high.join(', ')}` : '', low.length ? `Weak: ${low.join(', ')}` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Balanced';
}

function crossbreed(a, b, options = {}) {
  const { weightA = 0.5, seed } = options;
  const wB = 1 - weightA;
  const prng = seed !== undefined ? mulberry32(seed) : Math.random;
  const score = compatibilityScore(a.traits, b.traits, a.archetype, b.archetype);
  const tier  = compatibilityTier(score);
  const isSpark = tier === 'incompatible' && prng() < C.COMPATIBILITY_SPARK_CHANCE;
  if (tier === 'incompatible' && !isSpark) {
    return { parentIds: [a.id, b.id], generation: Math.max(a.generation, b.generation) + 1,
             traits: { ...a.traits }, voiceSeed: a.voiceSeed, compatScore: score,
             rejected: true, tier: 'incompatible', rejectionReason: "They sense the connection isn't right. Not yet." };
  }
  const sigma = isSpark ? C.TRAIT_MUTATION_SIGMA * 6 : tier === 'legendary' ? C.TRAIT_MUTATION_SIGMA * 0.5 : C.TRAIT_MUTATION_SIGMA;
  const noise = () => gaussianNoise(sigma, prng);
  const blend = (av, bv) => clamp01(av * weightA + bv * wB + noise());
  const blendOpt = (av, bv) => (av !== undefined || bv !== undefined) ? clamp01((av ?? 0.5) * weightA + (bv ?? 0.5) * wB + noise()) : undefined;
  const traits = {
    creativity: blend(a.traits.creativity, b.traits.creativity),
    empathy:    blend(a.traits.empathy,    b.traits.empathy),
    ambition:   blend(a.traits.ambition,   b.traits.ambition),
    humor:      blend(a.traits.humor,      b.traits.humor),
    logic:      blend(a.traits.logic,      b.traits.logic),
    curiosity:  blend(a.traits.curiosity,  b.traits.curiosity),
    loyalty:    blend(a.traits.loyalty,    b.traits.loyalty),
    patience:   blendOpt(a.traits.patience,   b.traits.patience),
    boldness:   blendOpt(a.traits.boldness,   b.traits.boldness),
    warmth:     blendOpt(a.traits.warmth,     b.traits.warmth),
    resilience: blendOpt(a.traits.resilience, b.traits.resilience),
  };
  const voiceBase   = Math.round(a.voiceSeed * weightA + b.voiceSeed * wB);
  const voiceJitter = Math.round((prng() - 0.5) * 2 * C.VOICE_SEED_NOISE_MAX);
  return {
    parentIds: [a.id, b.id], generation: Math.max(a.generation, b.generation) + 1,
    traits, voiceSeed: voiceBase + voiceJitter, compatScore: score,
    rejected: false, tier: isSpark ? 'legendary' : tier, spark: isSpark || undefined,
  };
}

// ── FASTIFY APP ──
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });

initStore();

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function agentId()  { return `agent-${Math.random().toString(36).slice(2,10)}`; }

// Health
app.get('/health', async () => ({
  status: 'ok', version: '0.2.0',
  archetypes: Object.keys(DEFAULT_ARCHETYPES).length,
  agents: agentStore.all().length,
  ts: new Date().toISOString(),
}));

// Static
app.get('/', async (_req, reply) => {
  reply.type('text/html').send(fs.readFileSync(path.join(publicDir, 'index.html')));
});
app.get('/icons/*', async (req, reply) => {
  const p = path.join(publicDir, req.url);
  if (fs.existsSync(p)) return reply.type('image/png').send(fs.readFileSync(p));
  reply.status(404).send({ error: 'Not found' });
});
app.get('/manifest.json', async (_req, reply) =>
  reply.type('application/manifest+json').send(fs.readFileSync(path.join(publicDir, 'manifest.json'))));
app.get('/sw.js', async (_req, reply) =>
  reply.type('application/javascript').send(fs.readFileSync(path.join(publicDir, 'sw.js'))));

// Archetypes
app.get('/api/archetypes', async () =>
  Object.entries(DEFAULT_ARCHETYPES).map(([name, traits]) => ({
    name, description: describeTraits(traits), traits,
  }))
);

// God Profile
app.post('/api/god/profile', async (req, reply) => {
  const { archetype, name, godId: bid } = req.body ?? {};
  if (!archetype || !DEFAULT_ARCHETYPES[archetype])
    return reply.status(400).send({ error: `Unknown archetype: ${archetype}` });
  if (!name?.trim()) return reply.status(400).send({ error: 'Name required' });
  const godId = bid ?? `god-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const profile = { archetype, name: name.trim(), createdAt: new Date().toISOString() };
  godStore.put(godId, profile);
  return { godId, ...profile };
});
app.get('/api/god/profile', async (req, reply) => {
  const { godId } = req.query;
  if (!godId) return reply.status(400).send({ error: 'Missing ?godId=' });
  const p = godStore.get(godId);
  if (!p) return reply.status(404).send({ error: 'Profile not found' });
  return { godId, ...p };
});

// Agents CRUD
app.post('/api/agents', async (req, reply) => {
  const { archetype, name, godId } = req.body ?? {};
  if (!archetype || !DEFAULT_ARCHETYPES[archetype])
    return reply.status(400).send({ error: `Unknown archetype: ${archetype}` });
  const all = agentStore.all();
  const owned = godId ? all.filter(a => a.godId === godId) : all;
  if (owned.length >= 12) return reply.status(400).send({ error: 'Max 12 agents per civilization' });
  const base = { ...DEFAULT_ARCHETYPES[archetype] };
  for (const k of Object.keys(base)) base[k] = Math.min(1, Math.max(0, base[k] + (Math.random() - 0.5) * 0.1));
  const agent = {
    id: agentId(), name: name?.trim() || pick(NAMES[archetype] ?? ['Soul']),
    archetype, traits: base,
    voiceSeed: Math.floor(Math.random() * 9999),
    voicePreset: pick(VOICE_PRESETS),
    generation: 1, parentIds: [], bornAt: new Date().toISOString(),
    lifecycleState: 'awakening', mood: 'curious',
    energy: 100, level: 1,
    lastSeenAt: null, lastMessage: 'I have just awakened. What world is this?',
    auraColor: AURA[archetype] ?? '#94a3b8',
    godId,
  };
  agentStore.put(agent);
  return agent;
});
app.get('/api/agents', async (req) => {
  const { godId } = req.query;
  const all = agentStore.all();
  return godId ? all.filter(a => a.godId === godId) : all;
});
app.get('/api/agents/:id', async (req, reply) => {
  const a = agentStore.get(req.params.id);
  if (!a) return reply.status(404).send({ error: 'Agent not found' });
  return a;
});
app.delete('/api/agents/:id', async (req, reply) => {
  if (!agentStore.del(req.params.id)) return reply.status(404).send({ error: 'Not found' });
  return { success: true };
});

// Daily Care
const CARE = {
  feed:  (_a) => ({ energyDelta: +25, mood: 'happy',   message: 'Mmm, that was delicious! I feel stronger.', label: '+25 energy' }),
  talk:  (_a) => ({ energyDelta: +10, mood: 'content',  message: 'I love our conversations. You truly see me.', label: '+10 energy' }),
  play:  (_a) => ({ energyDelta:  -5, mood: 'excited',  message: 'That was SO fun! Again? Please?', label: '-5 energy' }),
  sleep: (_a) => ({ energyDelta: +40, mood: 'content',  lifecycleState: 'dormant', message: 'Goodnight… I will dream of our sanctuary.', label: '+40 energy, sleep' }),
  wake:  (_a) => ({ energyDelta:   0, lifecycleState: 'active', mood: 'curious', message: "I'm awake! The sanctuary feels alive.", label: 'wake up' }),
};
app.post('/api/agents/:id/care', async (req, reply) => {
  const agent = agentStore.get(req.params.id);
  if (!agent) return reply.status(404).send({ error: 'Agent not found' });
  const eff = CARE[req.body?.action];
  if (!eff) return reply.status(400).send({ error: `Unknown action. Use: ${Object.keys(CARE).join(', ')}` });
  const e = eff(agent);
  const updated = {
    ...agent,
    energy: Math.min(100, Math.max(0, agent.energy + e.energyDelta)),
    mood: e.mood ?? agent.mood,
    lifecycleState: e.lifecycleState ?? agent.lifecycleState,
    lastMessage: e.message,
    lastSeenAt: new Date().toISOString(),
  };
  careStore.push(agent.id, { action: req.body.action, ts: new Date().toISOString() });
  const history = careStore.get(agent.id);
  updated.level = 1 + Math.floor(history.length / 10);
  agentStore.put(updated);
  return { success: true, label: e.label, agent: updated };
});
app.get('/api/agents/:id/care', async (req, reply) => {
  if (!agentStore.get(req.params.id)) return reply.status(404).send({ error: 'Not found' });
  return { agentId: req.params.id, history: careStore.get(req.params.id) };
});

// Crossbreed
app.post('/api/crossbreed', async (req, reply) => {
  const { agentIdA, agentIdB, archetypeA, archetypeB, seed } = req.body ?? {};
  const archs = DEFAULT_ARCHETYPES;
  const aA = agentIdA ? agentStore.get(agentIdA) : null;
  const aB = agentIdB ? agentStore.get(agentIdB) : null;
  const tA = aA?.traits ?? archs[archetypeA];
  const tB = aB?.traits ?? archs[archetypeB];
  if (!tA || !tB) return reply.status(400).send({ error: 'Provide agentIdA+agentIdB or archetypeA+archetypeB' });
  const r = crossbreed(
    { id: aA?.id ?? 'a', traits: tA, voiceSeed: aA?.voiceSeed ?? 100, generation: aA?.generation ?? 1, archetype: aA?.archetype ?? archetypeA },
    { id: aB?.id ?? 'b', traits: tB, voiceSeed: aB?.voiceSeed ?? 200, generation: aB?.generation ?? 1, archetype: aB?.archetype ?? archetypeB },
    { seed: seed ?? Math.floor(Math.random() * 99999) }
  );
  return {
    success: !r.rejected, tier: r.tier, spark: r.spark ?? false,
    compatScore: Math.round(r.compatScore * 1000) / 1000,
    traits: r.rejected ? null : r.traits,
    rejectionReason: r.rejectionReason ?? null,
    description: r.rejected ? null : describeTraits(r.traits),
  };
});

// Compat
app.get('/api/compat', async (req, reply) => {
  const { a, b } = req.query;
  if (!a || !b) return reply.status(400).send({ error: 'Missing ?a=&b=' });
  const ta = DEFAULT_ARCHETYPES[a], tb = DEFAULT_ARCHETYPES[b];
  if (!ta || !tb) return reply.status(404).send({ error: `Unknown: ${!ta ? a : b}` });
  const score = compatibilityScore(ta, tb, a, b);
  return { a, b, score: Math.round(score * 1000) / 1000, tier: compatibilityTier(score) };
});

// Energy decay (hourly)
setInterval(() => {
  for (const agent of agentStore.all()) {
    if (agent.lifecycleState === 'dormant') continue;
    const energy = Math.max(0, agent.energy - 2);
    agentStore.put({ ...agent, energy, lifecycleState: energy === 0 ? 'fading' : agent.lifecycleState });
  }
}, 60 * 60 * 1000);

// Start
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`🌿 Oasis API v0.2.0 on :${PORT}  (${process.env.NODE_ENV ?? 'dev'})`);
});
