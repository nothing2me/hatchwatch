// A fixed, made-up snapshot of the beach, used when the dashboard runs in
// sample mode (VITE_DATA_SOURCE=sample) without the backend. The live
// backend produces snapshots with this SAME shape.
//
// The zone and camera positions come from beachLayout.js; this file only
// adds made-up activity levels and camera statuses.

import { beachZones, beachCameraPairs } from './beachLayout.js';

const sampleActivityLevels = { A: 'medium', B: 'high', C: 'medium', D: 'low' };

export const sampleSnapshot =
{
    generatedAt: '2026-10-09T18:00:00Z',
    mode: 'sample',

    zones: beachZones.map(function addSampleLevel(zone)
    {
        return { ...zone, activityLevel: sampleActivityLevels[zone.zoneIdentifier] };
    }),

    cameraPairs: beachCameraPairs.map(function addSampleStatus(cameraPair)
    {
        return {
            ...cameraPair,
            feed: null,
            cameras: cameraPair.cameras.map(function addStatus(camera)
            {
                // A2 is shown offline so the half-working pair state is visible.
                const status = camera.cameraIdentifier === 'A2' ? 'offline' : 'online';
                return { ...camera, status, lastFrameTime: null, videoUrl: null };
            }),
        };
    }),
};
