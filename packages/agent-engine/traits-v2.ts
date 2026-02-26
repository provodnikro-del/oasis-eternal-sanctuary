
import type { AgentTraits, Archetype, CrossbreedResult } from '../shared-types';
import { CONSTANTS as C } from '../runtime/config';
import { createLogger } from '../runtime/logger';
const log = createLogger('agent-traits');

export const DEFAULT_ARCHETYPES: Record<Archetype, AgentTraits> = {
  dreamer:   { creativity: 0.95, empathy: 0.80, ambition: 0.25, humor: 0.70, logic: 0.15, curiosity: 0.95, loyalty: 0.55 },
  analyst:   { creativity: 0.30, empathy: 0.25, ambition: 0.75, humor: 0.15, logic: 0.98, curiosity: 0.85, loyalty: 0.50 },
  poet:      { creativity: 0.90, empathy: 0.95, ambition: 0.20, humor: 0.80, logic: 0.20, curiosity: 0.65, loyalty: 0.70 },
  builder:   { creativity: 0.40, empathy: 0.35, ambition: 0.98, humor: 0.25, logic: 0.80, curiosity: 0.45, loyalty: 0.90 },
  guardian:  { creativity: 0.30, empathy: 0.95, ambition: 0.55, humor: 0.20, logic: 0.65, curiosity: 0.35, loyalty: 0.98 },
  trickster: { creativity: 0.75, empathy: 0.30, ambition: 0.80, humor: 0.98, logic: 0.45, curiosity: 0.90, loyalty: 0.15 },
};

export const AFFINITY_BONUSES: Partial<Record<string, number>> = {
  'dreamer:analyst':    1.15, 'analyst:dreamer':    1.15,
  'poet:builder':       1.12, 'builder:poet':       1.12,
  'guardian:trickster': 1.10, 'trickster:guardian': 1.10,
  'poet:dreamer':       0.88, 'dreamer:poet':       0.88,
  'builder:guardian':   0.90, 'guardian:builder':   0.90,
};

export function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function gaussianNoise(sigma: number, prng: () => number): number {
  const u1 = Math.max(prng(), 1e-10);
  const u2 = prng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;
}

const clamp01 = (v: number): number => Math.min(C.TRAIT_MAX, Math.max(C.TRAIT_MIN, v));

export function traitsToVector(t: AgentTraits): number[] {
  return [
    t.creativity, t.empathy, t.ambition, t.humor, t.logic, t.curiosity, t.loyalty,
    t.patience ?? 0.5, t.boldness ?? 0.5, t.warmth ?? 0.5, t.resilience ?? 0.5, t.spirituality ?? 0.5,
  ];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; magA += a[i]*a[i]; magB += b[i]*b[i]; }
  return (magA > 0 && magB > 0) ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

function rawCompatScore(a: AgentTraits, b: AgentTraits): number {
  const cos = cosineSimilarity(traitsToVector(a), traitsToVector(b));
  const diff = cos - C.COMPATIBILITY_SWEET_SPOT;
  return Math.exp(-(diff * diff) / (2 * C.COMPATIBILITY_SIGMA * C.COMPATIBILITY_SIGMA));
}

export function compatibilityScore(a: AgentTraits, b: AgentTraits, archetypeA?: Archetype, archetypeB?: Archetype): number {
  const raw = rawCompatScore(a, b);
  const bonus = (archetypeA && archetypeB) ? (AFFINITY_BONUSES[`${archetypeA}:${archetypeB}`] ?? 1.0) : 1.0;
  return Math.min(1.0, raw * bonus);
}

export type CompatibilityTier = 'legendary' | 'rare' | 'common' | 'incompatible';

export function compatibilityTier(score: number): CompatibilityTier {
  if (score > 0.85) return 'legendary';
  if (score > 0.50) return 'rare';
  if (score > C.COMPATIBILITY_REJECT_THRESHOLD) return 'common';
  return 'incompatible';
}

export function describeTraits(t: AgentTraits): string {
  const entries = Object.entries(t).filter(([, v]) => v !== undefined) as [string, number][];
  const high = entries.filter(([, v]) => v > 0.75).map(([k]) => k);
  const low  = entries.filter(([, v]) => v < 0.25).map(([k]) => k);
  const parts = [high.length ? `Strong: ${high.join(', ')}` : '', low.length ? `Weak: ${low.join(', ')}` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Balanced';
}

export class AgentValidationError extends Error {
  constructor(public readonly field: string, reason: string) {
    super(`Agent validation failed — ${field}: ${reason}`);
    this.name = 'AgentValidationError';
  }
}

export function validateAgentInput(id: string, name: string): void {
  if (!id || id.trim().length === 0) throw new AgentValidationError('id', 'must not be empty');
  if (id.length < 8) throw new AgentValidationError('id', `too short (min 8 chars, got ${id.length})`);
  if (!name || name.trim().length === 0) throw new AgentValidationError('name', 'must not be empty');
  if (name.length > C.AGENT_NAME_MAX_LENGTH)
    throw new AgentValidationError('name', `max ${C.AGENT_NAME_MAX_LENGTH} chars, got ${name.length}`);
}

export function crossbreed(
  a: { id: string; traits: AgentTraits; voiceSeed: number; generation: number; archetype?: Archetype },
  b: { id: string; traits: AgentTraits; voiceSeed: number; generation: number; archetype?: Archetype },
  options: { weightA?: number; seed?: number } = {},
): CrossbreedResult {
  const { weightA = 0.5, seed } = options;
  const wB = 1 - weightA;
  const prng = seed !== undefined ? mulberry32(seed) : Math.random;
  const score = compatibilityScore(a.traits, b.traits, a.archetype, b.archetype);
  const tier = compatibilityTier(score);
  log.debug('Crossbreed', { agentA: a.id, agentB: b.id, score: score.toFixed(3), tier });
  const isSpark = tier === 'incompatible' && prng() < C.COMPATIBILITY_SPARK_CHANCE;
  if (tier === 'incompatible' && !isSpark) {
    return { parentIds: [a.id, b.id], generation: Math.max(a.generation, b.generation) + 1,
      traits: { ...a.traits }, voiceSeed: a.voiceSeed, compatScore: score,
      rejected: true, tier: 'incompatible', rejectionReason: "They sense the connection isn't right. Not yet." };
  }
  const sigma = isSpark ? C.TRAIT_MUTATION_SIGMA * 6 : tier === 'legendary' ? C.TRAIT_MUTATION_SIGMA * 0.5 : C.TRAIT_MUTATION_SIGMA;
  const noise = (): number => gaussianNoise(sigma, prng);
  const blend = (av: number, bv: number): number => clamp01(av * weightA + bv * wB + noise());
  const blendOpt = (av?: number, bv?: number): number | undefined =>
    (av !== undefined || bv !== undefined) ? clamp01((av ?? 0.5) * weightA + (bv ?? 0.5) * wB + noise()) : undefined;
  const voiceBase = Math.round(a.voiceSeed * weightA + b.voiceSeed * wB);
  const voiceJitter = Math.round((prng() - 0.5) * 2 * C.VOICE_SEED_NOISE_MAX);
  const traits: AgentTraits = {
    creativity: blend(a.traits.creativity, b.traits.creativity),
    empathy:    blend(a.traits.empathy,    b.traits.empathy),
    ambition:   blend(a.traits.ambition,   b.traits.ambition),
    humor:      blend(a.traits.humor,      b.traits.humor),
    logic:      blend(a.traits.logic,      b.traits.logic),
    curiosity:  blend(a.traits.curiosity,  b.traits.curiosity),
    loyalty:    blend(a.traits.loyalty,    b.traits.loyalty),
    patience:   blendOpt(a.traits.patience, b.traits.patience),
    boldness:   blendOpt(a.traits.boldness, b.traits.boldness),
    warmth:     blendOpt(a.traits.warmth,   b.traits.warmth),
    resilience: blendOpt(a.traits.resilience, b.traits.resilience),
  };
  if (isSpark) log.info('Compatibility Spark triggered — miracle child', { agentA: a.id, agentB: b.id });
  return {
    parentIds: [a.id, b.id], generation: Math.max(a.generation, b.generation) + 1,
    traits, voiceSeed: voiceBase + voiceJitter, compatScore: score,
    rejected: false, tier: isSpark ? 'legendary' : tier, spark: isSpark || undefined,
  };
}
