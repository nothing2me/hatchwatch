import type { AlertView, SiteSummary } from '@/lib/types';

export const openSite: SiteSummary = { protection: 'unprotected', nesting: 'unresolved', outcome: 'open', active: true, personActed: false, patrolVisited: false, detectedAt: null, archivedAt: null, danger: 'none', dangerDeadline: null };

export function siteAlert(id: string, site: Partial<SiteSummary> = {}, extra: Partial<AlertView> = {}): AlertView
{
    return {
        id, kind: 'DIGGING', message: 'Digging activity detected; nesting unresolved.', status: 'NEW', zoneCode: 'B', cameraCode: 'B1',
        position: [0.5, 0.5], radiusM: 0.9, score: 0.82, createdAt: '2026-10-09T00:00:00.000Z', videoId: `video-${id}`,
        simRunId: 'live-000001-abc', startT: 4, endT: 9, evidenceTier: 'TWO_CAMERA', simulated: true, level: 0, siteId: null, colorIndex: null,
        site: { ...openSite, ...site },
        ...extra,
    };
}
