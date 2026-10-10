import { describe, expect, it } from 'vitest';
import type { AlertView } from '@/lib/types';
import { alertKey, isActive, playbackKey, visibleAlerts } from '@/features/map/playback';

const alert = (id: string, simRunId: string | null, startT: number, endT: number, position: [number, number] | null = [1, 2]): AlertView => ({
    id, kind: 'DIGGING', message: 'Digging activity detected; nesting unresolved.', status: 'NEW', zoneCode: 'B', cameraCode: 'B1',
    position, radiusM: 0.9, score: 1, createdAt: '2026-10-09T00:00:00.000Z', videoId: `v-${id}`, simRunId, startT, endT,
    evidenceTier: 'TWO_CAMERA', simulated: simRunId !== null, level: 0, siteId: null, colorIndex: null,
    site: { protection: 'unprotected', nesting: 'unresolved', outcome: 'open', active: true, personActed: false, patrolVisited: false, detectedAt: null, archivedAt: null, damaged: false, danger: 'none', dangerDeadline: null, secured: null },
});

describe('playback gating', () =>
{
    const alerts = [alert('a', 'R1', 10, 20), alert('b', 'R1', 30, 40), alert('c', 'R2', 10, 20), alert('d', 'R1', 10, 20, null)];

    it('keys simulation videos by run so both cameras of a pair share pins', () =>
    {
        expect(playbackKey({ id: 'v1', simRunId: 'R1' })).toBe('R1');
        expect(playbackKey({ id: 'v1', simRunId: null })).toBe('v1');
        expect(alertKey(alerts[0])).toBe('R1');
    });

    it('activates inside the window with half a second of slack', () =>
    {
        expect(isActive(alerts[0], { key: 'R1', t: 9.6 })).toBe(true);
        expect(isActive(alerts[0], { key: 'R1', t: 20.4 })).toBe(true);
        expect(isActive(alerts[0], { key: 'R1', t: 25 })).toBe(false);
        expect(isActive(alerts[0], { key: 'R2', t: 15 })).toBe(false);
        expect(isActive(alerts[0], null)).toBe(false);
    });

    it('keeps all positioned site pins visible during playback', () =>
    {
        expect(visibleAlerts(alerts, null).map(a => a.id)).toEqual(['a', 'b', 'c']);
        expect(visibleAlerts(alerts, { key: 'R1', t: 15 }).map(a => a.id)).toEqual(['a', 'b', 'c']);
        expect(visibleAlerts(alerts, { key: 'R1', t: 50 }).map(a => a.id)).toEqual(['a', 'b', 'c']);
    });
});
