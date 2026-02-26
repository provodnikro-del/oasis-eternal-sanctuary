
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry { level: LogLevel; module: string; message: string; data?: Record<string, unknown>; ts: string; }
export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg:  string, data?: Record<string, unknown>): void;
  warn(msg:  string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}
let globalMinLevel: LogLevel = 'info';
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
export interface LogSink { write(entry: LogEntry): void; }
class ConsoleSink implements LogSink {
  write(e: LogEntry): void {
    const prefix = `[${e.ts.slice(11,19)}] [${e.level.toUpperCase().padEnd(5)}] [${e.module}]`;
    const msg = e.data ? `${e.message} ${JSON.stringify(e.data)}` : e.message;
    if (e.level === 'error') console.error(prefix, msg);
    else if (e.level === 'warn') console.warn(prefix, msg);
    else console.log(prefix, msg);
  }
}
export class CaptureSink implements LogSink {
  readonly entries: LogEntry[] = [];
  write(e: LogEntry): void { this.entries.push(e); }
  clear(): void { this.entries.length = 0; }
  byLevel(level: LogLevel): LogEntry[] { return this.entries.filter(e => e.level === level); }
}
let activeSink: LogSink = new ConsoleSink();
export function setLogSink(sink: LogSink): void { activeSink = sink; }
export function setLogLevel(level: LogLevel): void { globalMinLevel = level; }
export function createLogger(module: string): Logger {
  const log = (level: LogLevel, msg: string, data?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[globalMinLevel]) return;
    activeSink.write({ level, module, message: msg, data, ts: new Date().toISOString() });
  };
  return {
    debug: (msg, data) => log('debug', msg, data),
    info:  (msg, data) => log('info',  msg, data),
    warn:  (msg, data) => log('warn',  msg, data),
    error: (msg, data) => log('error', msg, data),
  };
}
