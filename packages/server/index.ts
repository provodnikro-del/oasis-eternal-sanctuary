
import Fastify from 'fastify';
import path from 'path';
import fs from 'fs';
import { DEFAULT_ARCHETYPES, compatibilityScore, compatibilityTier, crossbreed, describeTraits } from '../agent-engine/traits-v2';
import type { Archetype } from '../shared-types';
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const publicDir = path.join(__dirname, '../../public');

app.get('/health', async () => ({ status: 'ok', version: '0.1.0', archetypes: Object.keys(DEFAULT_ARCHETYPES).length, ts: new Date().toISOString() }));

app.get('/', async (_req, reply) => {
  reply.type('text/html').send(fs.readFileSync(path.join(publicDir, 'index.html')));
});

// Serve icons
app.get('/icons/*', async (req, reply) => {
  const iconPath = path.join(publicDir, (req as any).url);
  if (fs.existsSync(iconPath)) return reply.type('image/png').send(fs.readFileSync(iconPath));
  reply.status(404).send({ error: 'Not found' });
});

app.get('/manifest.json', async (_req, reply) => {
  reply.type('application/manifest+json').send(fs.readFileSync(path.join(publicDir, 'manifest.json')));
});

app.get('/sw.js', async (_req, reply) => {
  reply.type('application/javascript').send(fs.readFileSync(path.join(publicDir, 'sw.js')));
});

app.get<{ Querystring: { a?: string; b?: string } }>('/api/archetypes', async () =>
  Object.entries(DEFAULT_ARCHETYPES).map(([name, traits]) => ({ name, description: describeTraits(traits), traits }))
);

app.get<{ Querystring: { a?: string; b?: string } }>('/api/compat', async (req, reply) => {
  const { a, b } = req.query;
  if (!a || !b) return reply.status(400).send({ error: 'Missing ?a=&b=' });
  const ta = (DEFAULT_ARCHETYPES as any)[a];
  const tb = (DEFAULT_ARCHETYPES as any)[b];
  if (!ta || !tb) return reply.status(404).send({ error: `Unknown archetype: ${!ta ? a : b}` });
  const score = compatibilityScore(ta, tb, a as Archetype, b as Archetype);
  return { a, b, score: Math.round(score * 1000) / 1000, tier: compatibilityTier(score) };
});

app.post<{ Body: { archetypeA: string; archetypeB: string; seed?: number } }>('/api/crossbreed', async (req, reply) => {
  const { archetypeA, archetypeB, seed } = req.body ?? {};
  const archs = DEFAULT_ARCHETYPES as any;
  const ta = archs[archetypeA]; const tb = archs[archetypeB];
  if (!ta || !tb) return reply.status(400).send({ error: `Unknown archetype: ${!ta ? archetypeA : archetypeB}` });
  const result = crossbreed(
    { id: 'agent-aaaaaaaa', traits: ta, voiceSeed: 100, generation: 1, archetype: archetypeA as Archetype },
    { id: 'agent-bbbbbbbb', traits: tb, voiceSeed: 200, generation: 1, archetype: archetypeB as Archetype },
    { seed: seed ?? Math.floor(Math.random() * 99999) }
  );
  return { success: !result.rejected, tier: result.tier, spark: result.spark ?? false, compatScore: Math.round(result.compatScore * 1000) / 1000, traits: result.rejected ? null : result.traits, rejectionReason: result.rejectionReason ?? null, description: result.rejected ? null : describeTraits(result.traits) };
});

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`✦ Oasis API on :${PORT}  (${process.env.NODE_ENV ?? 'dev'})`);
});
