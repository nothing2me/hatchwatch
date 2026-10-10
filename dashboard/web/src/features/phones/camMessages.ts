export type QualityName = 'standard' | 'high';

export const QUALITY_PRESETS: Record<QualityName, { label: string; width: number; height: number; jpegQuality: number }> = {
    standard: { label: 'Standard (960×540)', width: 960, height: 540, jpegQuality: 0.7 },
    high: { label: 'High (1280×720)', width: 1280, height: 720, jpegQuality: 0.8 },
};

// Matches the 5 fps recording timeline and stays under the server's 10 frames/s cap.
export const SEND_FPS = 5;

export const MESSAGES = {
    https: 'This page is not on HTTPS, so the browser blocks the camera. Open the https:// address from the Connect phone QR code.',
    permission: 'Camera permission was denied. Allow camera access for this site in the browser settings, then press Start again.',
    noCamera: 'No camera was found on this device.',
    busy: 'The camera is in use by another app. Close it and press Start again.',
    signedOut: 'You were signed out. Sign in again to keep sending.',
    refused: 'The server refused this phone: your account cannot send, or an admin removed this phone.',
    tooLarge: 'A frame was larger than 500 KB. Choose Standard quality and press Start again.',
    offline: 'Connection lost. Retrying…',
    viewer: 'Your account can watch but not send.',
};

export function describeMediaError(error: unknown): string
{
    const name = error instanceof Error || error instanceof DOMException ? error.name : 'Error';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    {
        return MESSAGES.permission;
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError')
    {
        return MESSAGES.noCamera;
    }
    if (name === 'NotReadableError' || name === 'TrackStartError')
    {
        return MESSAGES.busy;
    }
    return `Could not open the camera (${name}).`;
}

export function describeFrameStatus(status: number): string | null
{
    if (status === 429)
    {
        return null;
    }
    if (status === 401)
    {
        return MESSAGES.signedOut;
    }
    if (status === 403)
    {
        return MESSAGES.refused;
    }
    if (status === 413)
    {
        return MESSAGES.tooLarge;
    }
    return `The server refused a frame (error ${status}).`;
}
