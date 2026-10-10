import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { BEACH_LENGTH, BEACH_WIDTH, sandFloor } from './sand';

function beachHeight(x: number, z: number) {
  const dune = Math.max(0, Math.min(1, (z - 8) / 68));
  const uneven = 0.035 * Math.sin(x * 0.63 + Math.sin(z * 0.41)) * Math.sin(z * 0.82)
    + 0.018 * Math.sin(x * 1.31 + z * 1.27) * Math.sin(z * 1.57);
  const ridge = dune * dune * (8.8 + 1.9 * Math.sin(x * 0.032) + 0.8 * Math.sin(x * 0.11 + 1.2));
  return sandFloor(z) + 0.42 + ridge + uneven;
}

// The broad surface is rendered as fine sand. The separate particle bed still
// simulates thrown grains, but individual 18 cm simulation cells are not used
// as the untouched beach's visible texture.
export class BeachEnvironment {
  readonly ready: Promise<void>;
  readonly ground: THREE.Mesh;
  readonly trackSurface: THREE.Mesh;
  readonly water: THREE.Mesh;
  readonly foam: THREE.Mesh;
  readonly sky: Sky;
  readonly nightSky: THREE.Mesh;
  private readonly waterMaterial: THREE.ShaderMaterial;
  private readonly washMaterial: THREE.ShaderMaterial;
  private readonly markCanvas: HTMLCanvasElement;
  private readonly marks: CanvasRenderingContext2D;
  private readonly markTexture: THREE.CanvasTexture;
  private lastMarksTime = -1;
  private readonly trackBase: Float32Array;
  private readonly trackOffset: Float32Array;
  private readonly liveVertices = new Set<number>();

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    const groundGeometry = new THREE.PlaneGeometry(360, 176, 360, 140);
    groundGeometry.rotateX(-Math.PI / 2);
    groundGeometry.translate(0, 0, 72); // coast at z=-16; dunes continue far inland
    const positions = groundGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      if (Math.abs(z + 16) < 0.01) positions.setZ(i, z + 0.42 * Math.sin(x * 0.052) + 0.17 * Math.sin(x * 0.19 + 0.7));
      positions.setY(i, beachHeight(x, positions.getZ(i)));
    }
    groundGeometry.computeVertexNormals();
    const sand = new THREE.MeshStandardMaterial({ color: 0xf4e7c8, roughness: 0.92 });
    sand.onBeforeCompile = shader => {
      shader.uniforms.uTrackMarks = { value: this.markTexture };
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {', 'varying vec2 vBeachXZ;\nvoid main() {');
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n  vBeachXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {', `varying vec2 vBeachXZ;
          uniform sampler2D uTrackMarks;
          vec2 sandHash(vec2 p) {
            return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
          }
          vec4 sampleSandStochastic(sampler2D tex, vec2 uv) {
            vec2 domain = uv / 1.2;
            vec2 cell = floor(domain);
            vec2 blend = smoothstep(vec2(0.0), vec2(1.0), fract(domain));
            vec4 c00 = texture2D(tex, uv + sandHash(cell) * 13.0);
            vec4 c10 = texture2D(tex, uv + sandHash(cell + vec2(1.0, 0.0)) * 13.0);
            vec4 c01 = texture2D(tex, uv + sandHash(cell + vec2(0.0, 1.0)) * 13.0);
            vec4 c11 = texture2D(tex, uv + sandHash(cell + vec2(1.0, 1.0)) * 13.0);
            return mix(mix(c00, c10, blend.x), mix(c01, c11, blend.x), blend.y);
          }
          void main() {`);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          diffuseColor *= sampleSandStochastic(map, vMapUv);
        #endif`);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
          float wet = 1.0 - smoothstep(-15.6, -10.6, vBeachXZ.y);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.54, 0.61, 0.62), wet);
          vec2 trackUv = vec2(vBeachXZ.x / 84.0 + 0.5, vBeachXZ.y / 32.0 + 0.5);
          float inside = step(0.0, trackUv.x) * step(trackUv.x, 1.0) * step(0.0, trackUv.y) * step(trackUv.y, 1.0);
          float scuff = texture2D(uTrackMarks, trackUv).a * inside;
          diffuseColor.rgb *= 1.0 - scuff * 0.62;`);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= sampleSandStochastic(roughnessMap, vRoughnessMapUv).g;
        #endif
        roughnessFactor = mix(roughnessFactor, 0.47, 1.0 - smoothstep(-15.6, -10.6, vBeachXZ.y));`);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 mapN = sampleSandStochastic(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
          mapN.xy *= normalScale;
          normal = normalize(tbn * mapN);
        #endif`);
    };
    this.ground = new THREE.Mesh(groundGeometry, sand);
    this.ground.receiveShadow = true;
    scene.add(this.ground);

    // A dense local surface turns contact with the granular bed into actual
    // relief. The broad dune stays coarse, so recordings do not pay for a
    // quarter-metre grid across the whole landscape.
    const trackGeometry = new THREE.PlaneGeometry(BEACH_LENGTH, BEACH_WIDTH, 336, 128);
    trackGeometry.rotateX(-Math.PI / 2);
    const trackPositions = trackGeometry.getAttribute('position') as THREE.BufferAttribute;
    this.trackBase = new Float32Array(trackPositions.count);
    this.trackOffset = new Float32Array(trackPositions.count);
    for (let i = 0; i < trackPositions.count; i++) {
      const y = beachHeight(trackPositions.getX(i), trackPositions.getZ(i)) + 0.027;
      this.trackBase[i] = y;
      trackPositions.setY(i, y);
    }
    trackGeometry.computeVertexNormals();
    this.trackSurface = new THREE.Mesh(trackGeometry, sand);
    this.trackSurface.receiveShadow = true;
    scene.add(this.trackSurface);

    // Static dune grass provides scale beyond the nesting area.
    const bladeVertices: number[] = [];
    for (let blade = 0; blade < 3; blade++) {
      const angle = blade * Math.PI * 2 / 3;
      const dx = Math.cos(angle), dz = Math.sin(angle);
      bladeVertices.push(-dx * 0.035, 0, -dz * 0.035, dx * 0.075, 0.3, dz * 0.075, dx * 0.035, 0, dz * 0.035);
    }
    const bladeGeometry = new THREE.BufferGeometry();
    bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bladeVertices, 3));
    bladeGeometry.computeVertexNormals();
    const grass = new THREE.InstancedMesh(bladeGeometry, new THREE.MeshStandardMaterial({ color: 0xc2b585, roughness: 1, side: THREE.DoubleSide }), 3600);
    const dummy = new THREE.Object3D();
    let state = 0x2352ad19;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    for (let i = 0; i < grass.count; i++) {
      const x = (random() - 0.5) * 330, z = 14 + random() * 119;
      dummy.position.set(x, beachHeight(x, z) - 0.02, z);
      dummy.rotation.set(0, random() * Math.PI * 2, 0);
      dummy.scale.setScalar(0.5 + random() * 1.25);
      dummy.updateMatrix(); grass.setMatrixAt(i, dummy.matrix);
      grass.setColorAt(i, new THREE.Color().setHSL(0.11 + random() * 0.05, 0.18 + random() * 0.12, 0.3 + random() * 0.22));
    }
    grass.instanceMatrix.needsUpdate = true;
    scene.add(grass);

    const detailGeometry = new THREE.IcosahedronGeometry(1, 1);
    const shells = new THREE.InstancedMesh(detailGeometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }), 190);
    for (let i = 0; i < shells.count; i++) {
      const x = (random() - 0.5) * 320, z = -11.2 + random() * 24;
      const radius = 0.025 + random() * 0.045;
      dummy.position.set(x, beachHeight(x, z) + radius * 0.2, z);
      dummy.rotation.set(random() * 0.2, random() * Math.PI * 2, random() * 0.2);
      dummy.scale.set(radius * (0.8 + random()), radius * 0.22, radius * (0.6 + random() * 0.7));
      dummy.updateMatrix(); shells.setMatrixAt(i, dummy.matrix);
      shells.setColorAt(i, new THREE.Color().setHSL(0.08 + random() * 0.06, 0.06 + random() * 0.14, 0.39 + random() * 0.21));
    }
    shells.instanceMatrix.needsUpdate = true;
    scene.add(shells);

    const wrack = new THREE.InstancedMesh(detailGeometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), 460);
    for (let i = 0; i < wrack.count; i++) {
      const x = (random() - 0.5) * 320, z = -9.9 + (random() - 0.5) * 2.4;
      const length = 0.06 + random() * 0.18;
      dummy.position.set(x, beachHeight(x, z) + 0.018, z);
      dummy.rotation.set(0, random() * Math.PI * 2, 0);
      dummy.scale.set(length, 0.018 + random() * 0.013, 0.025 + random() * 0.028);
      dummy.updateMatrix(); wrack.setMatrixAt(i, dummy.matrix);
      wrack.setColorAt(i, new THREE.Color().setHSL(0.13 + random() * 0.13, 0.17 + random() * 0.16, 0.16 + random() * 0.13));
    }
    wrack.instanceMatrix.needsUpdate = true;
    scene.add(wrack);

    const wood = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.055, 0.085, 1, 7), new THREE.MeshStandardMaterial({ color: 0x736958, roughness: 1 }), 12);
    for (let i = 0; i < wood.count; i++) {
      const side = i % 2 ? 1 : -1, x = side * (16 + random() * 140), z = -8.5 + (random() - 0.5) * 6;
      dummy.position.set(x, beachHeight(x, z) + 0.065, z);
      dummy.rotation.set(0, random() * Math.PI * 2, Math.PI / 2);
      dummy.scale.set(1, 0.7 + random() * 1.6, 1);
      dummy.updateMatrix(); wood.setMatrixAt(i, dummy.matrix);
    }
    wood.castShadow = true;
    wood.instanceMatrix.needsUpdate = true;
    scene.add(wood);

    const sky = new Sky();
    this.sky = sky;
    sky.scale.setScalar(1000);
    sky.material.uniforms.turbidity.value = 3;
    sky.material.uniforms.rayleigh.value = 2.1;
    sky.material.uniforms.mieCoefficient.value = 0.006;
    sky.material.uniforms.mieDirectionalG.value = 0.84;
    sky.material.uniforms.sunPosition.value.set(-70, 100, -40);
    scene.add(sky);

    const moonDirection = new THREE.Vector3(0.94, 0.23, -0.18).normalize();
    this.nightSky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { moonDirection: { value: moonDirection } },
      vertexShader: `varying vec3 vDirection; void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
      fragmentShader: `varying vec3 vDirection; uniform vec3 moonDirection; void main() {
        vec3 d = normalize(vDirection);
        float horizon = smoothstep(-0.10, 0.70, d.y);
        vec3 color = mix(vec3(0.007, 0.013, 0.027), vec3(0.018, 0.029, 0.052), horizon);
        float angle = dot(d, moonDirection);
        float halo = pow(max(angle, 0.0), 650.0);
        float disc = smoothstep(0.999982, 0.999992, angle);
        color += vec3(0.045, 0.075, 0.12) * halo + vec3(0.77, 0.82, 0.89) * disc;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    }));
    this.nightSky.scale.setScalar(900);
    this.nightSky.visible = false;
    scene.add(this.nightSky);

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, night: { value: 0 }, sunDirection: { value: new THREE.Vector3(-0.51, 0.74, -0.29).normalize() } },
      vertexShader: `varying vec3 vWorld; uniform float time;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          float shore = smoothstep(-34.0, -17.0, world.z);
          float phase = world.z * 1.35 + time * 1.9 + sin(world.x * 0.11) * 0.8;
          world.y += (0.007 + shore * 0.075) * sin(phase);
          world.y += 0.012 * sin(world.z * 0.38 + world.x * 0.14 - time * 0.8);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `varying vec3 vWorld;
        uniform float time; uniform float night; uniform vec3 sunDirection;
        void main() {
          float shore = smoothstep(-34.0, -17.0, vWorld.z);
          float phase = vWorld.z * 1.35 + time * 1.9 + sin(vWorld.x * 0.11) * 0.8;
          float longWave = sin(phase);
          float crossed = sin(vWorld.x * 0.51 + vWorld.z * 0.79 - time * 1.4);
          float fine = sin(vWorld.x * 3.7 - time * 1.8) * sin(vWorld.z * 2.9 + time * 1.1);
          vec3 n = normalize(vec3(-0.018 * crossed - 0.011 * fine, 1.0, -(0.005 + shore * 0.08) * cos(phase) - 0.012 * fine));
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
          float glint = pow(max(dot(reflect(-sunDirection, n), viewDir), 0.0), 80.0);
          vec3 deep = vec3(0.075, 0.23, 0.27);
          vec3 shallow = vec3(0.28, 0.49, 0.47);
          vec3 color = mix(deep, shallow, smoothstep(-38.0, -17.0, vWorld.z));
          color += vec3(0.018, 0.025, 0.025) * crossed + vec3(0.01) * fine;
          color = mix(color, vec3(0.60, 0.74, 0.74), fresnel * 0.68) + vec3(0.85, 0.78, 0.62) * glint * 0.65;
          float breakup = 0.67 + 0.33 * sin(vWorld.x * 0.9 + vWorld.z * 1.3) * sin(vWorld.x * 2.4 - time * 0.7);
          float crest = smoothstep(0.80, 0.96, longWave + 0.13 * crossed) * shore * shore * breakup;
          color = mix(color, vec3(0.78, 0.86, 0.82), crest * 0.48);
          color = mix(color, color * 0.025, night);
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(360, 180, 240, 120), this.waterMaterial);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, 0.38, -105);
    scene.add(this.water);

    this.washMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, night: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vShore; void main(){
        vec4 world = modelMatrix * vec4(position, 1.0);
        vShore = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
      fragmentShader: `varying vec2 vShore; uniform float time; uniform float night;
        void main(){
          float front = -14.9 + 0.7 * sin(time * 1.1) + 0.38 * sin(vShore.x * 0.12 + time * 0.34) + 0.16 * sin(vShore.x * 0.43 - time * 0.65);
          float behind = front - vShore.y;
          float water = smoothstep(-0.18, 0.28, behind) * (1.0 - smoothstep(1.7, 2.5, behind));
          float stipple = 0.65 + 0.35 * sin(vShore.x * 4.7 + vShore.y * 7.2) * sin(vShore.x * 9.3 - time * 1.2);
          float edgeFoam = exp(-pow(behind / 0.24, 2.0)) * stipple;
          float lace = smoothstep(0.72, 0.92, sin(vShore.x * 1.7 + vShore.y * 5.1 - time * 1.9)) * water * 0.35;
          vec3 color = mix(vec3(0.28, 0.48, 0.45), vec3(0.89, 0.91, 0.83), clamp(edgeFoam + lace, 0.0, 1.0));
          float alpha = clamp(0.34 * water + 0.66 * edgeFoam + 0.27 * lace, 0.0, 0.86);
          gl_FragColor = vec4(color * mix(1.0, 0.08, night), alpha * mix(1.0, 0.25, night));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const washGeometry = new THREE.PlaneGeometry(360, 6, 240, 16);
    washGeometry.rotateX(-Math.PI / 2);
    washGeometry.translate(0, 0, -14);
    const washPositions = washGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < washPositions.count; i++) washPositions.setY(i, beachHeight(washPositions.getX(i), washPositions.getZ(i)) + 0.02);
    this.foam = new THREE.Mesh(washGeometry, this.washMaterial);
    scene.add(this.foam);

    this.markCanvas = document.createElement('canvas');
    this.markCanvas.width = 2048; this.markCanvas.height = 512;
    this.marks = this.markCanvas.getContext('2d')!;
    this.markTexture = new THREE.CanvasTexture(this.markCanvas);
    this.markTexture.colorSpace = THREE.SRGBColorSpace;
    this.markTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const load = new THREE.TextureLoader();
    const url = (name: string) => new URL(`./assets/sand/${name}`, import.meta.url).href;
    this.ready = Promise.all([
      load.loadAsync(url('coast_sand_02_diff_1k.jpg')),
      load.loadAsync(url('coast_sand_02_nor_gl_1k.jpg')),
      load.loadAsync(url('coast_sand_02_rough_1k.jpg')),
    ]).then(([color, normal, roughness]) => {
      color.colorSpace = THREE.SRGBColorSpace;
      for (const texture of [color, normal, roughness]) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(120, 24);
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        texture.needsUpdate = true;
      }
      sand.map = color; sand.normalMap = normal; sand.normalScale.set(0.42, 0.42); sand.roughnessMap = roughness;
      sand.needsUpdate = true;
    });
  }

  setNight(night: boolean) {
    this.sky.visible = !night;
    this.nightSky.visible = night;
    this.waterMaterial.uniforms.night.value = night ? 1 : 0;
    this.washMaterial.uniforms.night.value = night ? 1 : 0;
    if(night)this.waterMaterial.uniforms.sunDirection.value.set(0.94, 0.23, -0.18).normalize();
  }

  private stamp(x: number, z: number, radius: number, depth: number) {
    const positions = this.trackSurface.geometry.getAttribute('position') as THREE.BufferAttribute;
    const left = Math.max(0, Math.floor((x - radius + BEACH_LENGTH / 2) * 4));
    const right = Math.min(336, Math.ceil((x + radius + BEACH_LENGTH / 2) * 4));
    const top = Math.max(0, Math.floor((z - radius + BEACH_WIDTH / 2) * 4));
    const bottom = Math.min(128, Math.ceil((z + radius + BEACH_WIDTH / 2) * 4));
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
      const i = row * 337 + col;
      const distance = Math.hypot(positions.getX(i) - x, positions.getZ(i) - z) / radius;
      if (distance >= 1) continue;
      const hollow = Math.exp(-distance * distance * 9);
      const rim = Math.exp(-Math.pow((distance - 0.72) * 8, 2));
      this.trackOffset[i] = THREE.MathUtils.clamp(this.trackOffset[i] - depth * hollow + depth * 0.45 * rim, -0.021, 0.031);
      positions.setY(i, this.trackBase[i] + this.trackOffset[i]);
    }
  }

  // The current flipper load is a smooth moving height field; the smaller
  // persistent stamps above remain when the animal moves away.
  setLiveContact(contacts: Array<{ x: number; z: number; heading: number; mode: string; time: number }>) {
    const positions = this.trackSurface.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (const i of this.liveVertices) positions.setY(i, this.trackBase[i] + this.trackOffset[i]);
    this.liveVertices.clear();
    const load = (x: number, z: number, radius: number, pressure: number) => {
      const left = Math.max(0, Math.floor((x - radius + BEACH_LENGTH / 2) * 4));
      const right = Math.min(336, Math.ceil((x + radius + BEACH_LENGTH / 2) * 4));
      const top = Math.max(0, Math.floor((z - radius + BEACH_WIDTH / 2) * 4));
      const bottom = Math.min(128, Math.ceil((z + radius + BEACH_WIDTH / 2) * 4));
      for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
        const i = row * 337 + col;
        const d = Math.hypot(positions.getX(i) - x, positions.getZ(i) - z) / radius;
        if (d >= 1) continue;
        const ridge = Math.exp(-Math.pow((d - 0.59) * 5.2, 2));
        const hollow = Math.exp(-d * d * 12);
        const delta = pressure * (0.072 * ridge - 0.02 * hollow);
        positions.setY(i, Math.max(this.trackBase[i] - 0.018, positions.getY(i) + delta));
        this.liveVertices.add(i);
      }
    };
    for (const contact of contacts) {
      if (contact.mode === 'none') continue;
      const forwardX = Math.sin(contact.heading), forwardZ = Math.cos(contact.heading);
      const sideX = Math.cos(contact.heading), sideZ = -Math.sin(contact.heading);
      const phase = contact.time * 7.4;
      for (const side of [-1, 1]) {
        const stroke = Math.sin(phase + (side > 0 ? Math.PI : 0));
        const pressure = contact.mode === 'travel' ? 0.35 + 0.65 * (stroke + 1) / 2 : 1.2;
        const foreAft = contact.mode === 'travel' ? stroke * 0.22 : 0;
        load(contact.x + side * sideX * 0.49 - forwardX * foreAft,
          contact.z + side * sideZ * 0.49 - forwardZ * foreAft,
          contact.mode === 'travel' ? 0.72 : 1.0, pressure);
      }
    }
    positions.needsUpdate = true;
    this.trackSurface.geometry.computeVertexNormals();
  }

  update(t: number, trackPositions: Array<{ x: number; z: number; heading: number; digging: boolean }>) {
    this.waterMaterial.uniforms.time.value = t;
    this.washMaterial.uniforms.time.value = t;
    if (t < this.lastMarksTime) {
      this.marks.clearRect(0, 0, 2048, 512);
      this.trackOffset.fill(0);
      const positions = this.trackSurface.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i++) positions.setY(i, this.trackBase[i]);
      this.liveVertices.clear();
      this.lastMarksTime = -1;
    }
    if (t <= this.lastMarksTime) return;
    const ctx = this.marks;
    const paint = (x: number, z: number, r: number, opacity: number) => {
      const px = (x / BEACH_LENGTH + 0.5) * 2048;
      const py = (0.5 - z / BEACH_WIDTH) * 512;
      const gradient = ctx.createRadialGradient(px, py, 0, px, py, r * 2048 / BEACH_LENGTH);
      gradient.addColorStop(0, `rgba(75, 62, 42, ${opacity})`);
      gradient.addColorStop(1, 'rgba(75, 62, 42, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.arc(px, py, r * 2048 / BEACH_LENGTH, 0, Math.PI * 2); ctx.fill();
    };
    for (const point of trackPositions) {
      if (point.digging) {
        paint(point.x, point.z, 0.72, 0.14);
        this.stamp(point.x, point.z, 1.05, 0.012);
      } else {
        paint(point.x, point.z, 0.25, 0.18);
        const sideX = Math.cos(point.heading) * 0.47, sideZ = -Math.sin(point.heading) * 0.47;
        paint(point.x + sideX, point.z + sideZ, 0.24, 0.23);
        paint(point.x - sideX, point.z - sideZ, 0.24, 0.23);
        this.stamp(point.x + sideX, point.z + sideZ, 0.5, 0.015);
        this.stamp(point.x - sideX, point.z - sideZ, 0.5, 0.015);
      }
    }
    this.markTexture.needsUpdate = true;
    this.lastMarksTime = t;
  }
}
