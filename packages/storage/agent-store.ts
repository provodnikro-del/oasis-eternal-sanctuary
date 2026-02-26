
import fs from 'fs';
import path from 'path';

const DATA_DIR  = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

export interface GodProfile { name: string; archetype: string; createdAt: string; }
export interface CareEntry  { action: string; ts: string; }

interface StoreData {
  agents:      Record<string, any>;
  godProfiles: Record<string, GodProfile>;
  careHistory: Record<string, CareEntry[]>;
}

let mem: StoreData = { agents: {}, godProfiles: {}, careHistory: {} };

export function initStore(): void {
  try {
    if (fs.existsSync(STORE_FILE)) mem = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch { /* fresh start */ }
}

function save(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(mem));
  } catch { /* ephemeral env */ }
}

export const agentStore = {
  all:  ()             => Object.values(mem.agents) as any[],
  get:  (id: string)   => mem.agents[id] as any,
  put:  (a: any)       => { mem.agents[a.id] = a; save(); return a; },
  del:  (id: string)   => {
    if (!mem.agents[id]) return false;
    delete mem.agents[id]; save(); return true;
  },
};

export const godStore = {
  get: (id: string)                    => mem.godProfiles[id] as GodProfile | undefined,
  put: (id: string, p: GodProfile)     => { mem.godProfiles[id] = p; save(); },
};

export const careStore = {
  push: (agentId: string, e: CareEntry) => {
    if (!mem.careHistory[agentId]) mem.careHistory[agentId] = [];
    mem.careHistory[agentId].push(e);
    if (mem.careHistory[agentId].length > 100) mem.careHistory[agentId].splice(0, 50);
    save();
  },
  get: (agentId: string) => mem.careHistory[agentId] ?? [] as CareEntry[],
};
