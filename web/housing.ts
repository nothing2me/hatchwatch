import * as THREE from 'three';
import { sandFloor } from './sand';

// Pole-mounted camera housings for the installed-on-the-beach story (see
// docs/HOUSING.md for the printable reference design). Purely decorative:
// they are static, so they vanish into the extractor's median background and
// produce no motion signals; they never feed the detector and never occlude
// the calibrated ground region (sites are inside z ∈ [-8, 8], poles sit on
// the dune line at z ≥ 13).

const POLE_RADIUS = 0.035;
const POLE_HEIGHT = 2.4;
const HOUSING = { w: 0.22, h: 0.16, d: 0.13 };

function housingPole(scene: THREE.Scene, x: number, z: number, seawardSide: 1 | -1): THREE.Group
{
    const base = sandFloor(z) + 0.03;
    const group = new THREE.Group();
    group.position.set(x, base, z);

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8f8d86, roughness: 0.85 });
    const housingMat = new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c2228, roughness: 0.4 });
    const solarMat = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.35, metalness: 0.4 });

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS * 1.15, POLE_HEIGHT, 10), poleMat);
    pole.position.y = POLE_HEIGHT / 2;
    pole.castShadow = true;

    const camFace: 1 | -1 = seawardSide; // front face looks toward the water
    const housing = new THREE.Mesh(new THREE.BoxGeometry(HOUSING.w, HOUSING.h, HOUSING.d), housingMat);
    housing.position.set(0, POLE_HEIGHT - 0.12, 0);
    housing.castShadow = true;

    // Camera window facing the sea.
    const window = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.012), darkMat);
    window.position.set(0, POLE_HEIGHT - 0.12, (camFace * HOUSING.d) / 2 + 0.006);

    // Tilted solar panel on top.
    const solar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.016, 0.14), solarMat);
    solar.position.set(0, POLE_HEIGHT + HOUSING.h / 2, 0);
    solar.rotation.x = camFace > 0 ? THREE.MathUtils.degToRad(-25) : THREE.MathUtils.degToRad(25);
    solar.castShadow = true;

    // Small antenna stub for scale.
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.18, 6), poleMat);
    stub.position.set(-HOUSING.w / 2, POLE_HEIGHT + 0.16, 0);

    group.add(pole, housing, window, solar, stub);
    scene.add(group);
    return group;
}

/** Installs pole-mounted housings on the dune line, one per camera flank plus
 * one visible mid-beach anchor. Returns the created groups for callers. */
export function addHousingPoles(scene: THREE.Scene): THREE.Group[]
{
    const groups: THREE.Group[] = [];
    // Along-layout cameras sit at x = ±28 looking inward; housings stand
    // behind them on the dune line, facing the water.
    groups.push(housingPole(scene, -34.5, 15.0, 1));
    groups.push(housingPole(scene, 34.5, 15.0, -1));
    // Mid-beach installation visible from both far-end cameras and the preview.
    groups.push(housingPole(scene, 2.0, 13.5, 1));
    return groups;
}