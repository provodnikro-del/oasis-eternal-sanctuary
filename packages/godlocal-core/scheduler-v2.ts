
import type { AgentId, SleepSet, MicroSession, MorningDigest, MemorySnapshot, WorldAction, Message, Vector3, StructureType, ResourceType } from '../shared-types';
import type { EventBus } from '../runtime/event-bus';
import { CONSTANTS as C } from '../runtime/config';
import { createLogger } from '../runtime/logger';
import { mulberry32 } from '../agent-engine/traits-v2';
const log = createLogger('sleep-scheduler');

export interface GodLocalAdapter { infer(p: { systemPrompt: string; userMessage: string; context: string; maxTokens?: number; }): Promise<string>; }
export interface ReasoningBankAdapter { saveMemory(m: MemorySnapshot): Promise<void>; saveSleepSet(s: SleepSet): Promise<void>; }
export interface WorldStateAdapter { applyMutations(mutations: WorldAction[]): Promise<void>; getSummary(): Promise<string>; }
export interface AgentSnapshot { id: AgentId; name: string; archetype: string; mood: string; energy: number; lastSeenAt: string | null; traits: { loyalty: number; empathy: number; ambition: number; }; }
export interface SleepSetConfig { sessionCount?: number; maxParticipants?: number; inferTimeoutMs?: number; seed?: number; }

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(id); resolve(v); }, e => { clearTimeout(id); reject(e); });
  });
}

export function rollingContextWindow(current: string, newEntry: string, maxChars = C.CONTEXT_MAX_CHARS): string {
  const combined = current + '\n' + newEntry;
  if (combined.length <= maxChars) return combined;
  const trimmed = combined.slice(combined.length - C.CONTEXT_TRIM_TARGET);
  const firstNL = trimmed.indexOf('\n');
  return firstNL > -1 ? trimmed.slice(firstNL + 1) : trimmed;
}

function priorityScore(a: AgentSnapshot, all: AgentSnapshot[]): number {
  const days = a.lastSeenAt ? (Date.now() - new Date(a.lastSeenAt).getTime()) / C.MS_PER_DAY : 1;
  const relStrength = (a.traits.loyalty + a.traits.empathy) / 2;
  const avgCompat = all.length > 1 ? all.filter(x => x.id !== a.id).reduce((s, o) => s + (a.traits.loyalty + o.traits.empathy) / 2, 0) / (all.length - 1) : 0.5;
  return days * C.PRIORITY_WEIGHT_DAYS_SINCE + relStrength * C.PRIORITY_WEIGHT_REL_STRENGTH + a.traits.ambition * C.PRIORITY_WEIGHT_GOAL_URGENCY + avgCompat * C.PRIORITY_WEIGHT_COMPAT;
}

function selectParticipants(agents: AgentSnapshot[], max: number): AgentSnapshot[] {
  if (agents.length <= max) return agents;
  return [...agents].sort((a, b) => priorityScore(b, agents) - priorityScore(a, agents)).slice(0, max);
}

function detectWorldAction(text: string, prng: () => number): WorldAction | undefined {
  const loc = (): Vector3 => ({ x: Math.round(prng() * 100), y: 0, z: Math.round(prng() * 100) });
  if (/\b(build|construct|erect|raise|create)\b.{0,30}\b(tower|cottage|lab|laboratory|garden|library|temple|observatory|bridge|monument)\b/i.test(text)) {
    const match = text.match(/\b(tower|cottage|lab|laboratory|garden|library|temple|observatory|bridge|monument)\b/i);
    return { type: 'build', structure: (match?.[1]?.toLowerCase() ?? 'tower') as StructureType, location: loc() };
  }
  if (/\b(plant|grow|seed|sow)\b/i.test(text)) return { type: 'plant', flora: 'oak', location: loc() };
  if (/\b(gather|collect|harvest)\b.{0,20}\b(stone|wood|water|crystal|starlight)\b/i.test(text)) {
    const match = text.match(/\b(stone|wood|water|crystal|starlight)\b/i);
    return { type: 'gather', resource: (match?.[1]?.toLowerCase() ?? 'stone') as ResourceType, amount: 1 + Math.round(prng() * 4) };
  }
  return undefined;
}

export async function runSleepSet(agents: AgentSnapshot[], gl: GodLocalAdapter, rb: ReasoningBankAdapter, ws: WorldStateAdapter, config: SleepSetConfig = {}, bus?: EventBus): Promise<SleepSet> {
  const { sessionCount = C.SLEEP_SESSION_COUNT_DEFAULT, maxParticipants = C.SLEEP_MAX_PARTICIPANTS_DEFAULT, inferTimeoutMs = C.INFER_TIMEOUT_MS, seed } = config;
  const setId = `sleep_${seed ?? Date.now()}`;
  const startedAt = new Date().toISOString();
  const prng = seed !== undefined ? mulberry32(seed) : Math.random;
  log.info('SleepSet started', { setId, agents: agents.length, sessionCount, seed });
  bus?.emit({ type: 'sleep_set.started', payload: { setId }, timestamp: startedAt });
  const participants = selectParticipants(agents, maxParticipants);
  if (!participants.length) throw new Error('No agents available for SLEEP Set');
  const worldSummary = await ws.getSummary();
  let ctx = `World: ${worldSummary} | Agents: ${participants.map(a => a.name).join(', ')}`;
  const sessions: MicroSession[] = [];
  const mutations: WorldAction[] = [];
  for (let i = 1; i <= sessionCount; i++) {
    const initiator = participants[(i - 1) % participants.length];
    const responder = participants[i % participants.length];
    const t0 = Date.now();
    try {
      const aText = await withTimeout(gl.infer({ systemPrompt: `You are ${initiator.name} (${initiator.archetype}). Mood: ${initiator.mood}. It is night in the Oasis.`, userMessage: `You are with ${responder.name}. Context: ${ctx.slice(-400)}. Continue naturally in 1-2 sentences.`, context: ctx, maxTokens: 100 }), inferTimeoutMs, `session ${i} initiator`);
      const bText = await withTimeout(gl.infer({ systemPrompt: `You are ${responder.name} (${responder.archetype}). Mood: ${responder.mood}.`, userMessage: `${initiator.name} says: "${aText}". Respond in 1-2 sentences.`, context: ctx + '\n' + aText, maxTokens: 100 }), inferTimeoutMs, `session ${i} responder`);
      const mem: MemorySnapshot = { agentId: initiator.id, content: `Night with ${responder.name}: "${aText.slice(0, 60)}" / "${bText.slice(0, 60)}"`, emotionalWeight: (initiator.traits.empathy + responder.traits.empathy) / 2, timestamp: new Date().toISOString() };
      await rb.saveMemory(mem);
      const action = detectWorldAction(aText + ' ' + bText, prng);
      if (action) mutations.push(action);
      const exchanges: Message[] = [{ agentId: initiator.id, content: aText, timestamp: new Date().toISOString() }, { agentId: responder.id, content: bText, timestamp: new Date().toISOString() }];
      sessions.push({ index: i, initiatorId: initiator.id, responderId: responder.id, context: ctx, exchanges, worldAction: action, memories: [mem], durationMs: Date.now() - t0 });
      ctx = rollingContextWindow(ctx, `[S${i}] ${initiator.name}: ${aText.slice(0, 80)} | ${responder.name}: ${bText.slice(0, 80)}`);
      bus?.emit({ type: 'sleep_set.session_complete', payload: { setId, index: i }, timestamp: new Date().toISOString() });
    } catch (err) { log.error('Session failed', { index: i, error: (err as Error).message }); }
  }
  if (mutations.length) await ws.applyMutations(mutations);
  const narrator = participants[0];
  const sessionText = sessions.flatMap(s => s.exchanges).map(e => e.content).join(' ').slice(0, 900);
  let digestText = 'The night passed in silence.';
  try {
    digestText = await withTimeout(gl.infer({ systemPrompt: `You are ${narrator.name}. Write a 2-3 sentence morning update. Start with "While you were away..."`, userMessage: `What happened: ${sessionText}`, context: '', maxTokens: 160 }), inferTimeoutMs, 'digest');
  } catch (err) { log.error('Digest failed, using fallback', { error: (err as Error).message }); }
  const digest: MorningDigest = { narratorAgentId: narrator.id, text: digestText, highlight: digestText.split(/[.!?]/)[0].trim() + '.' };
  const aborted = sessions.length === 0;
  const set: SleepSet = { id: setId, date: new Date().toISOString().split('T')[0], participantIds: participants.map(a => a.id), sessions, worldMutations: mutations, digest, startedAt, completedAt: new Date().toISOString(), aborted, abortReason: aborted ? 'interrupted' : undefined, seed };
  await rb.saveSleepSet(set);
  bus?.emit({ type: aborted ? 'sleep_set.aborted' : 'sleep_set.completed', payload: { setId, sessions: sessions.length }, timestamp: new Date().toISOString() });
  return set;
}
