
import Fastify from 'fastify';
import path from 'path';
import fs from 'fs';
import { DEFAULT_ARCHETYPES, compatibilityScore, compatibilityTier, crossbreed, describeTraits } from '../agent-engine/traits-v2';
import type { Archetype, Agent, VoicePreset } from '../shared-types';
import { initStore, agentStore, godStore, careStore } from '../storage/agent-store';

const app  = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const publicDir = path.join(__dirname, '../../public');

initStore();

// ── Static ────────────────────────────────────────────────────────────────────
app.get('/health', async () => ({
  status: 'ok', version: '0.2.0',
  archetypes: Object.keys(DEFAULT_ARCHETYPES).length,
  agents: agentStore.all().length,
  ts: new Date().toISOString(),
}));

app.get('/', async (_req, reply) => {
  reply.type('text/html').send(fs.readFileSync(path.join(publicDir, 'index.html')));
});
app.get('/icons/*', async (req, reply) => {
  const p = path.join(publicDir, (req as any).url);
  if (fs.existsSync(p)) return reply.type('image/png').send(fs.readFileSync(p));
  reply.status(404).send({ error: 'Not found' });
});
app.get('/manifest.json', async (_req, reply) =>
  reply.type('application/manifest+json').send(fs.readFileSync(path.join(publicDir, 'manifest.json'))));
app.get('/sw.js', async (_req, reply) =>
  reply.type('application/javascript').send(fs.readFileSync(path.join(publicDir, 'sw.js'))));

// ── Archetypes ─────────────────────────────────────────────────────────────────
app.get('/api/archetypes', async () =>
  Object.entries(DEFAULT_ARCHETYPES).map(([name, traits]) => ({
    name, description: describeTraits(traits), traits,
  }))
);

// ── God Profile ────────────────────────────────────────────────────────────────
app.post<{ Body: { archetype: string; name: string; godId?: string } }>(
  '/api/god/profile', async (req, reply) => {
    const { archetype, name, godId: bid } = req.body ?? {};
    if (!archetype || !(DEFAULT_ARCHETYPES as any)[archetype])
      return reply.status(400).send({ error: `Unknown archetype: ${archetype}` });
    if (!name?.trim()) return reply.status(400).send({ error: 'Name required' });
    const godId = bid ?? `god-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const profile = { archetype, name: name.trim(), createdAt: new Date().toISOString() };
    godStore.put(godId, profile);
    return { godId, ...profile };
  }
);
app.get<{ Querystring: { godId?: string } }>('/api/god/profile', async (req, reply) => {
  const { godId } = req.query;
  if (!godId) return reply.status(400).send({ error: 'Missing ?godId=' });
  const p = godStore.get(godId);
  if (!p) return reply.status(404).send({ error: 'Profile not found' });
  return { godId, ...p };
});

// ── Agents CRUD ────────────────────────────────────────────────────────────────
const NAMES: Record<string, string[]> = {
  dreamer:   ['Aelura','Vespyr','Luneth','Mirael','Sorath'],
  analyst:   ['Nexus','Calcrix','Dathai','Veriton','Axiom'],
  poet:      ['Lyrien','Syllava','Verse','Melodra','Eloque'],
  builder:   ['Korrak','Stonewin','Arkos','Ferrath','Construx'],
  guardian:  ['Aethon','Shieldan','Wardis','Fortex','Prothal'],
  trickster: ['Flickwyr','Shade','Jestrix','Rogue','Mirthex'],
};
const AURA: Record<string, string> = {
  dreamer:'#a78bfa', analyst:'#60a5fa', poet:'#f472b6',
  builder:'#f59e0b', guardian:'#34d399', trickster:'#f97316',
};
const VOICE_PRESETS: VoicePreset[] = ['soft_warm','deep_resonant','bright_playful','calm_clear','ethereal'];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function agentId()            { return `agent-${Math.random().toString(36).slice(2,10)}`; }

app.post<{ Body: { archetype: string; name?: string; godId?: string } }>(
  '/api/agents', async (req, reply) => {
    const { archetype, name, godId } = req.body ?? {};
    if (!archetype || !(DEFAULT_ARCHETYPES as any)[archetype])
      return reply.status(400).send({ error: `Unknown archetype: ${archetype}` });
    const all = agentStore.all();
    const owned = godId ? all.filter((a: any) => a.godId === godId) : all;
    if (owned.length >= 12) return reply.status(400).send({ error: 'Max 12 agents per civilization' });

    const base = { ...(DEFAULT_ARCHETYPES as any)[archetype] };
    for (const k of Object.keys(base))
      base[k] = Math.min(1, Math.max(0, base[k] + (Math.random() - 0.5) * 0.1));

    const agent: any = {
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
  }
);

app.get<{ Querystring: { godId?: string } }>('/api/agents', async (req) => {
  const { godId } = req.query;
  const all = agentStore.all();
  return godId ? all.filter((a: any) => a.godId === godId) : all;
});

app.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
  const a = agentStore.get(req.params.id);
  if (!a) return reply.status(404).send({ error: 'Agent not found' });
  return a;
});

app.delete<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
  if (!agentStore.del(req.params.id)) return reply.status(404).send({ error: 'Not found' });
  return { success: true };
});

// ── Daily Care ─────────────────────────────────────────────────────────────────
interface CareEffect { energyDelta: number; mood?: string; lifecycleState?: string; message: string; label: string; }
const CARE: Record<string, (a: any) => CareEffect> = {
  feed:  (_a) => ({ energyDelta: +25, mood: 'happy',       message: 'Mmm, that was delicious! I feel stronger.', label: '+25 energy' }),
  talk:  (_a) => ({ energyDelta: +10, mood: 'content',     message: 'I love our conversations. You truly see me.', label: '+10 energy' }),
  play:  (_a) => ({ energyDelta:  -5, mood: 'excited',     message: 'That was SO fun! Again? Please?', label: '-5 energy' }),
  sleep: (_a) => ({ energyDelta: +40, mood: 'content', lifecycleState: 'dormant',
                    message: 'Goodnight… I will dream of our sanctuary.', label: '+40 energy, sleep' }),
  wake:  (_a) => ({ energyDelta:   0, lifecycleState: 'active', mood: 'curious',
                    message: 'I\'m awake! The sanctuary feels alive.', label: 'wake up' }),
};

app.post<{ Params: { id: string }; Body: { action: string } }>(
  '/api/agents/:id/care', async (req, reply) => {
    const agent = agentStore.get(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const eff = CARE[req.body?.action];
    if (!eff) return reply.status(400).send({ error: `Unknown action. Use: ${Object.keys(CARE).join(', ')}` });
    const e = eff(agent);
    const updated: any = {
      ...agent,
      energy: Math.min(100, Math.max(0, agent.energy + e.energyDelta)),
      mood:   e.mood ?? agent.mood,
      lifecycleState: e.lifecycleState ?? agent.lifecycleState,
      lastMessage: e.message,
      lastSeenAt:  new Date().toISOString(),
    };
    // level up every 10 care actions
    careStore.push(agent.id, { action: req.body.action, ts: new Date().toISOString() });
    const history = careStore.get(agent.id);
    updated.level = 1 + Math.floor(history.length / 10);
    agentStore.put(updated);
    return { success: true, label: e.label, agent: updated };
  }
);

app.get<{ Params: { id: string } }>('/api/agents/:id/care', async (req, reply) => {
  if (!agentStore.get(req.params.id)) return reply.status(404).send({ error: 'Not found' });
  return { agentId: req.params.id, history: careStore.get(req.params.id) };
});

// ── Crossbreed (stored agents or archetypes) ───────────────────────────────────
app.post<{ Body: { agentIdA?: string; agentIdB?: string; archetypeA?: string; archetypeB?: string; seed?: number } }>(
  '/api/crossbreed', async (req, reply) => {
    const { agentIdA, agentIdB, archetypeA, archetypeB, seed } = req.body ?? {};
    const archs = DEFAULT_ARCHETYPES as any;
    const aA: any = agentIdA ? agentStore.get(agentIdA) : null;
    const aB: any = agentIdB ? agentStore.get(agentIdB) : null;
    const tA = aA?.traits ?? archs[archetypeA ?? ''];
    const tB = aB?.traits ?? archs[archetypeB ?? ''];
    if (!tA || !tB) return reply.status(400).send({ error: 'Provide agentIdA+agentIdB or archetypeA+archetypeB' });
    const r = crossbreed(
      { id: aA?.id ?? 'a', traits: tA, voiceSeed: aA?.voiceSeed ?? 100, generation: aA?.generation ?? 1, archetype: (aA?.archetype ?? archetypeA) as Archetype },
      { id: aB?.id ?? 'b', traits: tB, voiceSeed: aB?.voiceSeed ?? 200, generation: aB?.generation ?? 1, archetype: (aB?.archetype ?? archetypeB) as Archetype },
      { seed: seed ?? Math.floor(Math.random() * 99999) }
    );
    return {
      success: !r.rejected, tier: r.tier, spark: r.spark ?? false,
      compatScore: Math.round(r.compatScore * 1000) / 1000,
      traits: r.rejected ? null : r.traits,
      rejectionReason: r.rejectionReason ?? null,
      description: r.rejected ? null : describeTraits(r.traits),
    };
  }
);

// ── Compat (unchanged) ─────────────────────────────────────────────────────────
app.get<{ Querystring: { a?: string; b?: string } }>('/api/compat', async (req, reply) => {
  const { a, b } = req.query;
  if (!a || !b) return reply.status(400).send({ error: 'Missing ?a=&b=' });
  const ta = (DEFAULT_ARCHETYPES as any)[a], tb = (DEFAULT_ARCHETYPES as any)[b];
  if (!ta || !tb) return reply.status(404).send({ error: `Unknown: ${!ta ? a : b}` });
  const score = compatibilityScore(ta, tb, a as Archetype, b as Archetype);
  return { a, b, score: Math.round(score * 1000) / 1000, tier: compatibilityTier(score) };
});

// ── Energy decay (hourly) ──────────────────────────────────────────────────────
setInterval(() => {
  for (const agent of agentStore.all()) {
    if (agent.lifecycleState === 'dormant') continue;
    const energy = Math.max(0, agent.energy - 2);
    agentStore.put({ ...agent, energy, lifecycleState: energy === 0 ? 'fading' : agent.lifecycleState });
  }
}, 60 * 60 * 1000);

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`🌿 Oasis API v0.2.0 on :${PORT}  (${process.env.NODE_ENV ?? 'dev'})`);
});
