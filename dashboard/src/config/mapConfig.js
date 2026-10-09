// Settings for the beach map image the dashboard draws on.
//
// Every position in the data (zone outlines, camera spots) is measured in
// PIXELS of this image, with (0, 0) at the top-left corner. Keeping the
// overlay in image pixels means the zones and cameras always line up with
// the map, no matter how big or small the map is drawn on screen.

export const mapConfig =
{
    // Path to the map image inside the "public" folder.
    imageSource: '/maps/holiday-beach.png',

    // The image's real size in pixels. The overlay uses the same size as
    // its coordinate system, so these must match the image file exactly.
    imageWidth: 926,
    imageHeight: 974,

    // Plain-language description for screen readers.
    imageDescription:
        'Street map of the Holiday Beach area of Port Aransas, with the beach running diagonally from lower left to upper right',

    // Credit required by OpenStreetMap's license.
    attribution: '© OpenStreetMap contributors',
};
