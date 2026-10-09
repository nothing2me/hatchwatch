// Small math helpers for drawing on the map overlay.

// Converts degrees to radians, because JavaScript's Math functions use radians.
export function degreesToRadians(angleInDegrees)
{
    return (angleInDegrees * Math.PI) / 180;
}

// Builds an SVG path string for a camera's field of view: a triangle
// ("cone") starting at the camera and opening up in the direction it faces.
export function buildFieldOfViewPath(camera)
{
    const headingInRadians = degreesToRadians(camera.headingDegrees);

    // Half of the viewing angle goes to each side of the center line.
    const halfAngleInRadians = degreesToRadians(camera.fieldOfViewDegrees / 2);

    const startX = camera.position.x;
    const startY = camera.position.y;

    // Far corner on one side of the cone.
    const firstCornerX = startX + camera.viewDistance * Math.cos(headingInRadians - halfAngleInRadians);
    const firstCornerY = startY + camera.viewDistance * Math.sin(headingInRadians - halfAngleInRadians);

    // Far corner on the other side of the cone.
    const secondCornerX = startX + camera.viewDistance * Math.cos(headingInRadians + halfAngleInRadians);
    const secondCornerY = startY + camera.viewDistance * Math.sin(headingInRadians + halfAngleInRadians);

    // M = move to the camera, L = draw lines to each corner, Z = close the shape.
    return `M${startX},${startY} L${firstCornerX},${firstCornerY} L${secondCornerX},${secondCornerY} Z`;
}

// Turns a list of [x, y] pairs into the "x,y x,y ..." text an SVG polygon needs.
export function buildPolygonPointsText(outlinePoints)
{
    return outlinePoints.map(function joinPoint(point)
    {
        return `${point[0]},${point[1]}`;
    }).join(' ');
}
