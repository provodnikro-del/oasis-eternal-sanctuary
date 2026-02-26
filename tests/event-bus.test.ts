
import { createEventBus } from '../packages/runtime/event-bus';
import type { OasisEvent } from '../packages/shared-types';
function makeEvent(type: OasisEvent['type']): OasisEvent<{ agentId: string }> {
  return { type, payload: { agentId: 'test-00000001' }, timestamp: new Date().toISOString() };
}
describe('EventBus', () => {
  test('handler called on matching event', () => {
    const bus = createEventBus(); const calls: OasisEvent[] = [];
    bus.on('agent.created', e => calls.push(e));
    bus.emit(makeEvent('agent.created'));
    expect(calls).toHaveLength(1);
  });
  test('wildcard handler called for any event', () => {
    const bus = createEventBus(); const calls: OasisEvent[] = [];
    bus.on('*', e => calls.push(e));
    bus.emit(makeEvent('agent.created'));
    bus.emit(makeEvent('sleep_set.completed'));
    expect(calls).toHaveLength(2);
  });
  test('unsubscribe stops receiving events', () => {
    const bus = createEventBus(); const calls: OasisEvent[] = [];
    const unsub = bus.on('agent.created', e => calls.push(e));
    bus.emit(makeEvent('agent.created')); unsub();
    bus.emit(makeEvent('agent.created'));
    expect(calls).toHaveLength(1);
  });
  test('once handler fires only once', () => {
    const bus = createEventBus(); const calls: OasisEvent[] = [];
    bus.once('agent.created', e => calls.push(e));
    bus.emit(makeEvent('agent.created')); bus.emit(makeEvent('agent.created'));
    expect(calls).toHaveLength(1);
  });
  test('error in one handler does not block others', () => {
    const bus = createEventBus(); const good: OasisEvent[] = [];
    bus.on('agent.created', () => { throw new Error('intentional'); });
    bus.on('agent.created', e => good.push(e));
    expect(() => bus.emit(makeEvent('agent.created'))).not.toThrow();
    expect(good).toHaveLength(1);
  });
  test('clear() removes all handlers', () => {
    const bus = createEventBus(); const calls: OasisEvent[] = [];
    bus.on('agent.created', e => calls.push(e));
    bus.clear(); bus.emit(makeEvent('agent.created'));
    expect(calls).toHaveLength(0);
  });
  test('replay buffer delivers past events to new subscriber', () => {
    const bus = createEventBus({ replayBufferSize: 5 });
    bus.emit(makeEvent('agent.created'));
    const received: OasisEvent[] = [];
    bus.on('agent.created', e => received.push(e));
    expect(received).toHaveLength(1);
  });
  test('multiple handlers for same event all called', () => {
    const bus = createEventBus(); let count = 0;
    bus.on('memory.saved', () => count++); bus.on('memory.saved', () => count++); bus.on('memory.saved', () => count++);
    bus.emit(makeEvent('memory.saved')); expect(count).toBe(3);
  });
});
