'use client';

import type { DetectionsView } from '@/lib/types';
import { useLiveDevices } from './useLiveDevices';

// The newest detections for one device, from the shared /api/live/devices poll (every 1 s while enabled). Null when off, missing or failing.
export function useDeviceDetections(deviceId: string | null, enabled: boolean): DetectionsView | null
{
    const polling = enabled && deviceId !== null;
    const { devices, error } = useLiveDevices(polling ? 1000 : null);
    if (!polling || error)
    {
        return null;
    }
    return devices.find(device => device.id === deviceId)?.detections ?? null;
}
