
export type AgentId = string;
export type MemoryId = string;
export type SleepSetId = string;

export interface Vector3 { x: number; y: number; z: number; }

export interface AgentTraits {
  creativity: number; empathy: number; ambition: number; humor: number;
  logic: number; curiosity: number; loyalty: number;
  patience?:     number;
  boldness?:     number;
  warmth?:       number;
  resilience?:   number;
  spirituality?: number;
}

export type Archetype =
  | 'dreamer' | 'analyst' | 'poet'
  | 'builder' | 'guardian' | 'trickster';

export type VoicePreset = 'soft_warm' | 'deep_resonant' | 'bright_playful' | 'calm_clear' | 'ethereal';
export type AgentMood = string;
export type AgentLifecycleState =
  | 'dormant' | 'awakening' | 'active' | 'waiting'
  | 'lonely' | 'fading' | 'crossbreeding' | 'ancestral';
export type MoodState =
  | 'excited' | 'happy' | 'content' | 'neutral'
  | 'contemplative' | 'melancholic' | 'anxious' | 'joyful';

export interface Agent {
  id: AgentId; name: string; archetype: Archetype;
  traits: AgentTraits; voiceSeed: number; voicePreset: VoicePreset;
  generation: number; parentIds: AgentId[]; bornAt: string;
  lifecycleState: AgentLifecycleState; mood: MoodState | AgentMood;
  energy: number; level: number;
  lastSeenAt: string | null; lastMessage: string | null; auraColor: string;
}

export interface CrossbreedResult {
  parentIds: [AgentId, AgentId]; generation: number; traits: AgentTraits;
  voiceSeed: number; compatScore: number; rejected: boolean;
  rejectionReason?: string;
  tier?: 'legendary' | 'rare' | 'common' | 'incompatible';
  spark?: boolean;
}

export interface AgentRecord {
  id: AgentId; name: string; traitsJson: string; archetype: Archetype;
  generation: number; bornAt: string; parentIds: AgentId[];
}

export type OasisEventType =
  | 'agent.created' | 'agent.mood_changed' | 'agent.lifecycle_changed'
  | 'agent.energy_changed' | 'agent.energy_decayed' | 'memory.saved'
  | 'sleep_set.started' | 'sleep_set.session_complete'
  | 'sleep_set.completed' | 'sleep_set.aborted' | 'world.mutated';

export interface OasisEvent<T = unknown> {
  type: OasisEventType; payload: T; timestamp: string; agentId?: string;
}

export type StructureType =
  | 'tower' | 'cottage' | 'lab' | 'laboratory' | 'garden'
  | 'library' | 'temple' | 'observatory' | 'bridge' | 'monument';

export type ResourceType = 'stone' | 'wood' | 'water' | 'crystal' | 'starlight';

export type WorldAction =
  | { type: 'build';  structure: StructureType; location: Vector3 }
  | { type: 'plant';  flora: string;            location: Vector3 }
  | { type: 'gather'; resource: ResourceType;   amount: number    };

export interface MemorySnapshot {
  agentId: AgentId; content: string;
  emotionalWeight: number; timestamp: string;
}

export interface Message { agentId: AgentId; content: string; timestamp: string; }

export interface MicroSession {
  index: number; initiatorId: AgentId; responderId: AgentId;
  context: string; exchanges: Message[];
  worldAction?: WorldAction; memories: MemorySnapshot[]; durationMs: number;
}

export interface MorningDigest {
  narratorAgentId: AgentId; text: string; highlight: string;
}

export interface SleepSet {
  id: SleepSetId; date: string; participantIds: AgentId[];
  sessions: MicroSession[]; worldMutations: WorldAction[];
  digest: MorningDigest; startedAt: string; completedAt: string;
  aborted: boolean; abortReason?: string; seed?: number;
}

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'emotional';

export interface MemoryRecord {
  id: string; agentId: string; type: MemoryType;
  content: string; emotionalWeight: number; timestamp: string;
}
