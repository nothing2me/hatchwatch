// Plain-language reason a camera could not start. Insecure pages come first: browsers hide the camera there.
export function describeMediaError(error: unknown, secureContext: boolean): string
{
    if (!secureContext)
    {
        return 'Camera access needs a secure page. Open this link with https:// (scan the QR code on the dashboard).';
    }
    const name = (error as { name?: string } | null)?.name;
    switch (name)
    {
        case 'NotAllowedError':
        case 'SecurityError':
            return 'Camera permission was denied. Allow camera access for this site in the browser settings and try again.';
        case 'NotFoundError':
            return 'No camera was found on this device.';
        case 'NotReadableError':
            return 'The camera is in use by another app. Close it and try again.';
        case 'OverconstrainedError':
            return 'This camera does not support the requested resolution. Try the other camera.';
        default:
            return 'The camera could not start. Reload the page and try again.';
    }
}
