import { EventEmitter } from 'node:events';

const globalBus = globalThis as unknown as { __nesttraceChanges?: EventEmitter };
const bus = globalBus.__nesttraceChanges ??= (() =>
{
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    return emitter;
})();

export function publishChange(reason: string): void
{
    bus.emit('change', reason);
}

export function onChange(listener: (reason: string) => void): () => void
{
    bus.on('change', listener);
    return () => { bus.off('change', listener); };
}
