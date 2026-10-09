// A small zoomed-in crop of the beach map centered on one nest site, so a
// patrol can see where to walk. It reuses the main map image: the SVG's
// viewBox just looks at a smaller window of it.

import { mapConfig } from '../config/mapConfig.js';

// Size of the cropped window, in map image pixels.
const cropWidth = 240;
const cropHeight = 170;

export default function NestLocationPreview({ position, pinFill, nestIdentifier })
{
    // Center the crop on the site, but keep it inside the image edges.
    const cropLeft = Math.min(Math.max(position.x - cropWidth / 2, 0), mapConfig.imageWidth - cropWidth);
    const cropTop = Math.min(Math.max(position.y - cropHeight / 2, 0), mapConfig.imageHeight - cropHeight);

    return (
        <svg
            className="nest-location-preview"
            viewBox={`${cropLeft} ${cropTop} ${cropWidth} ${cropHeight}`}
            role="img"
            aria-label={`Map close-up of ${nestIdentifier}`}
        >
            <image href={mapConfig.imageSource} width={mapConfig.imageWidth} height={mapConfig.imageHeight} />
            <circle cx={position.x} cy={position.y} r="18" fill={pinFill} fillOpacity="0.18" stroke={pinFill} strokeWidth="1.5" strokeDasharray="4 3" />
            <circle cx={position.x} cy={position.y} r="7" fill={pinFill} stroke="#FFFFFF" strokeWidth="2.5" />
        </svg>
    );
}
