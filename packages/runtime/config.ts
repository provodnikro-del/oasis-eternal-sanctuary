
export const CONSTANTS = {
  TRAIT_MIN: 0.0, TRAIT_MAX: 1.0, TRAIT_MUTATION_SIGMA: 0.05,
  ENERGY_MAX: 100, ENERGY_DECAY_PER_HOUR: 2, ENERGY_IDLE_DECAY_HOURS: 48, ENERGY_IDLE_DECAY_RATE: 5,
  COMPATIBILITY_SWEET_SPOT: 0.75, COMPATIBILITY_SIGMA: 0.18,
  COMPATIBILITY_REJECT_THRESHOLD: 0.08, COMPATIBILITY_SPARK_CHANCE: 0.03,
  PRIORITY_WEIGHT_DAYS_SINCE: 0.4, PRIORITY_WEIGHT_REL_STRENGTH: 0.3,
  PRIORITY_WEIGHT_GOAL_URGENCY: 0.2, PRIORITY_WEIGHT_COMPAT: 0.1,
  CONTEXT_MAX_CHARS: 2_000, CONTEXT_TRIM_TARGET: 1_200,
  VOICE_SEED_NOISE_MAX: 10, SLEEP_SESSION_COUNT_DEFAULT: 5,
  SLEEP_MAX_PARTICIPANTS_DEFAULT: 3, INFER_TIMEOUT_MS: 8_000,
  MS_PER_HOUR: 3_600_000, MS_PER_DAY: 86_400_000,
  KUZU_CONTEXT_MAX_CHARS: 800, AGENT_NAME_MIN_LENGTH: 1,
  AGENT_NAME_MAX_LENGTH: 30, LEVEL_MAX: 10, LEVEL_ANCESTOR: 10,
} as const;

export interface OasisConfig {
  env: 'development' | 'production' | 'test';
  db: { kuzuPath: string; chromaUrl?: string; };
  sleep: { sessionCount: number; maxParticipants: number; inferTimeoutMs: number; seed?: number; enabled: boolean; };
  voice: { barkModelPath: string; whisperModelPath: string; };
  bazaar: { apiUrl: string; authToken: string; };
  log: { level: 'debug' | 'info' | 'warn' | 'error'; };
}

type ValidationError = { field: string; message: string };

function validateEnv(raw: NodeJS.ProcessEnv): { config: OasisConfig; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const optionalInt = (key: string, def: number): number => {
    const v = raw[key]; if (!v) return def;
    const n = parseInt(v, 10);
    if (isNaN(n)) { errors.push({ field: key, message: `must be integer, got "${v}"` }); return def; }
    return n;
  };
  const optionalBool = (key: string, def: boolean): boolean => {
    const v = raw[key]; if (!v) return def;
    if (v === 'true') return true; if (v === 'false') return false;
    errors.push({ field: key, message: `must be "true" or "false", got "${v}"` }); return def;
  };
  const envType = (raw['NODE_ENV'] ?? 'development') as OasisConfig['env'];
  const isTest = envType === 'test';
  const cfg: OasisConfig = {
    env: envType,
    db: { kuzuPath: raw['KUZU_DB_PATH'] ?? (isTest ? ':memory:' : ''), chromaUrl: raw['CHROMA_URL'] },
    sleep: {
      sessionCount: optionalInt('SLEEP_SESSION_COUNT', CONSTANTS.SLEEP_SESSION_COUNT_DEFAULT),
      maxParticipants: optionalInt('SLEEP_MAX_PARTICIPANTS', CONSTANTS.SLEEP_MAX_PARTICIPANTS_DEFAULT),
      inferTimeoutMs: optionalInt('INFER_TIMEOUT_MS', CONSTANTS.INFER_TIMEOUT_MS),
      seed: raw['SLEEP_SEED'] ? optionalInt('SLEEP_SEED', 0) : undefined,
      enabled: optionalBool('SLEEP_ENABLED', true),
    },
    voice: { barkModelPath: raw['BARK_MODEL_PATH'] ?? '', whisperModelPath: raw['WHISPER_MODEL_PATH'] ?? '' },
    bazaar: { apiUrl: raw['BAZAAR_API_URL'] ?? 'https://api.bazaar.oasis.app/v1', authToken: raw['BAZAAR_AUTH_TOKEN'] ?? '' },
    log: { level: (raw['LOG_LEVEL'] ?? 'info') as OasisConfig['log']['level'] },
  };
  if (envType === 'production') {
    if (!cfg.db.kuzuPath) errors.push({ field: 'KUZU_DB_PATH', message: 'required in production' });
  }
  return { config: cfg, errors };
}

let _config: OasisConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OasisConfig {
  const { config, errors } = validateEnv(env);
  if (errors.length > 0) {
    const report = errors.map(e => `  - ${e.field}: ${e.message}`).join('\n');
    throw new Error(`Oasis config validation failed:\n${report}`);
  }
  _config = config; return config;
}

export function getConfig(): OasisConfig {
  if (!_config) throw new Error('Config not loaded. Call loadConfig() first.');
  return _config;
}

if (typeof process !== 'undefined' && process.env['NODE_ENV'] !== 'test') {
  try { loadConfig(); } catch (e) { console.warn('[oasis/config]', (e as Error).message); }
}

export { CONSTANTS as C };
