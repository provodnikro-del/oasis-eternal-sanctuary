
import type { Agent, AgentLifecycleState, AgentMood } from '../shared-types';
import type { EventBus } from '../runtime/event-bus';
import { CONSTANTS as C } from '../runtime/config';
import { createLogger } from '../runtime/logger';
const log = createLogger('agent-state-machine');
const VALID_TRANSITIONS: Record<AgentLifecycleState, AgentLifecycleState[]> = {
  dormant: ['awakening'], awakening: ['active'],
  active: ['waiting', 'lonely', 'fading', 'ancestral', 'crossbreeding'],
  waiting: ['active', 'lonely'], lonely: ['active', 'fading'],
  fading: ['active'], ancestral: [], crossbreeding: ['active'],
};
export function computeTargetState(agent: Agent): AgentLifecycleState {
  const hoursSince = agent.lastSeenAt ? (Date.now() - new Date(agent.lastSeenAt).getTime()) / C.MS_PER_HOUR : Infinity;
  if (agent.level >= C.LEVEL_ANCESTOR && agent.lifecycleState === 'active') return 'ancestral';
  if (agent.lifecycleState === 'dormant') return 'dormant';
  if (agent.energy < 20 && hoursSince > C.ENERGY_IDLE_DECAY_HOURS) return 'fading';
  if (hoursSince >= 48 && hoursSince < 168) return 'lonely';
  if (hoursSince >= 1 && hoursSince < 48) return 'waiting';
  return 'active';
}
export class AgentStateMachine {
  constructor(private agent: Agent, private readonly bus?: EventBus) {}
  get state(): AgentLifecycleState { return this.agent.lifecycleState; }
  transition(to: AgentLifecycleState): Agent {
    const from = this.agent.lifecycleState;
    if (from === to) return this.agent;
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed.includes(to)) throw new AgentTransitionError(this.agent.id, from, to);
    const updated: Agent = { ...this.agent, lifecycleState: to, mood: transitionMood(from, to, this.agent) as any };
    this.agent = updated;
    log.info('State transition', { agentId: updated.id, from, to });
    this.bus?.emit({ type: 'agent.lifecycle_changed', payload: { agentId: updated.id, from, to }, agentId: updated.id, timestamp: new Date().toISOString() });
    return updated;
  }
  sync(): Agent {
    const target = computeTargetState(this.agent);
    const allowed = VALID_TRANSITIONS[this.agent.lifecycleState];
    if (allowed.includes(target)) return this.transition(target);
    return this.agent;
  }
  decayEnergy(elapsedHours: number): Agent {
    const hoursSinceUser = this.agent.lastSeenAt ? (Date.now() - new Date(this.agent.lastSeenAt).getTime()) / C.MS_PER_HOUR : elapsedHours;
    const decayRate = hoursSinceUser > C.ENERGY_IDLE_DECAY_HOURS ? C.ENERGY_IDLE_DECAY_RATE : C.ENERGY_DECAY_PER_HOUR;
    const newEnergy = Math.max(0, this.agent.energy - decayRate * elapsedHours);
    const updated: Agent = { ...this.agent, energy: newEnergy };
    this.agent = updated;
    this.bus?.emit({ type: 'agent.energy_changed' as any, payload: { agentId: updated.id, energy: newEnergy }, agentId: updated.id, timestamp: new Date().toISOString() });
    return this.sync();
  }
}
function transitionMood(from: AgentLifecycleState, to: AgentLifecycleState, agent: Agent): string {
  switch (to) {
    case 'awakening': return 'excited';
    case 'active': return from === 'fading' || from === 'lonely' ? 'excited' : agent.mood as string;
    case 'waiting': return 'content';
    case 'lonely': return 'contemplative';
    case 'fading': return 'melancholy';
    case 'ancestral': return 'focused';
    case 'crossbreeding': return 'playful';
    default: return agent.mood as string;
  }
}
export class AgentTransitionError extends Error {
  constructor(public readonly agentId: string, public readonly from: AgentLifecycleState, public readonly to: AgentLifecycleState) {
    super(`Invalid transition for agent ${agentId}: ${from} → ${to}`);
    this.name = 'AgentTransitionError';
  }
}
