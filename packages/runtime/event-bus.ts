
import type { OasisEvent, OasisEventType } from '../shared-types';
export type EventHandler<T = unknown> = (event: OasisEvent<T>) => void | Promise<void>;
export interface EventBus {
  emit<T>(event: OasisEvent<T>): void;
  on<T>(type: OasisEventType | '*', handler: EventHandler<T>): () => void;
  off<T>(type: OasisEventType | '*', handler: EventHandler<T>): void;
  once<T>(type: OasisEventType, handler: EventHandler<T>): void;
  clear(): void;
}
interface HandlerEntry { handler: EventHandler<unknown>; once: boolean; }
export function createEventBus(options: { replayBufferSize?: number } = {}): EventBus {
  const { replayBufferSize = 0 } = options;
  const listeners = new Map<string, HandlerEntry[]>();
  const replayBuffer: OasisEvent<unknown>[] = [];
  function getHandlers(type: string): HandlerEntry[] {
    if (!listeners.has(type)) listeners.set(type, []);
    return listeners.get(type)!;
  }
  function emit<T>(event: OasisEvent<T>): void {
    if (replayBufferSize > 0) {
      replayBuffer.push(event as OasisEvent<unknown>);
      if (replayBuffer.length > replayBufferSize) replayBuffer.shift();
    }
    const toCall = [...getHandlers(event.type), ...getHandlers('*')];
    for (const entry of toCall) {
      try {
        const result = entry.handler(event as OasisEvent<unknown>);
        if (result instanceof Promise) result.catch(err => console.error(`[EventBus] async error on "${event.type}":`, err));
      } catch (err) { console.error(`[EventBus] sync error on "${event.type}":`, err); }
    }
    for (const type of [event.type, '*']) {
      const handlers = listeners.get(type);
      if (handlers) listeners.set(type, handlers.filter(h => !h.once));
    }
  }
  function on<T>(type: OasisEventType | '*', handler: EventHandler<T>): () => void {
    getHandlers(type).push({ handler: handler as EventHandler<unknown>, once: false });
    if (replayBufferSize > 0 && type !== '*') {
      replayBuffer.filter(e => e.type === type).forEach(e => { try { handler(e as OasisEvent<T>); } catch {} });
    }
    return () => off(type, handler);
  }
  function off<T>(type: OasisEventType | '*', handler: EventHandler<T>): void {
    const handlers = listeners.get(type);
    if (!handlers) return;
    listeners.set(type, handlers.filter(h => h.handler !== (handler as EventHandler<unknown>)));
  }
  function once<T>(type: OasisEventType, handler: EventHandler<T>): void {
    getHandlers(type).push({ handler: handler as EventHandler<unknown>, once: true });
  }
  function clear(): void { listeners.clear(); replayBuffer.length = 0; }
  return { emit, on, off, once, clear };
}
export const globalBus = createEventBus();
