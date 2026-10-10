// A map click that began on marker UI (camera, zone tag). Markers render as React portals, so React handles their
// click before it bubbles to the map and may already have swapped the clicked element out (the × of a zone tag turns
// into its confirm buttons); a detached target therefore also counts.
export function isMarkerClick(target: EventTarget | null | undefined): boolean
{
    return target instanceof Element && (!target.isConnected || target.closest('.maplibregl-marker') !== null);
}
