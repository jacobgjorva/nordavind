// Trollskogen: nattlig nordisk skog der agentene lever som steintroll rundt
// et bål. Bygget rett på three.js (ingen react-three-fiber) så render-løkka
// kan styres hardt: FPS-tak, pause når fanen er skjult, full opprydding.
//
// Visuell retning (fra referansene): avrundede steintroll med mosetopp og
// blanke svarte øyne; mørk blågrønn skog, varmt bål i midten, ildfluer,
// tett tåke. Alt er prosedyregenerert — ingen eksterne assets.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AgentInfo, AgentState } from "../../lib/api";

const FPS_CAP = 30;
const ISLAND_R = 28; // radius på den svevende øya
// Sen ettermiddag: klar blå himmel som varmes svakt mot horisonten.
const FOG_COLOR = 0x93a8bd;

// skyTexture: vertikal gradient som himmel — strekkes over hele bakgrunnen.
function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#3f6a9e");
  g.addColorStop(0.5, "#7fa3c2");
  g.addColorStop(0.8, "#c2cfc9");
  g.addColorStop(1, "#e8c98a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// hash gir et stabilt tall fra en streng — posisjon, form og pynt følger
// agent-id, så trollet ser likt ut hver gang.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// noise3: billig organisk støy av summerte sinuser — nok til stein og terreng.
function noise3(x: number, y: number, z: number): number {
  return (
    Math.sin(x * 3.1 + y * 1.7) * 0.5 +
    Math.sin(y * 4.3 + z * 2.3) * 0.3 +
    Math.sin(z * 5.7 + x * 2.9) * 0.2
  );
}

// textSprite tegner tekst på canvas → sprite (navneskilt og tilstandsbobler).
function textSprite(text: string, opts?: { size?: number; color?: string; bg?: string; scale?: number }): THREE.Sprite {
  const size = opts?.size ?? 44;
  const pad = 18;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = size + pad * 2;
  canvas.width = w * 2;
  canvas.height = h * 2;
  const c2 = canvas.getContext("2d")!;
  c2.scale(2, 2);
  if (opts?.bg) {
    c2.fillStyle = opts.bg;
    c2.beginPath();
    c2.roundRect(0, 0, w, h, 12);
    c2.fill();
  }
  c2.font = `600 ${size}px system-ui, sans-serif`;
  c2.fillStyle = opts?.color ?? "#e8f0ea";
  c2.textAlign = "center";
  c2.textBaseline = "middle";
  c2.fillText(text, w / 2, h / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  );
  const scale = opts?.scale ?? 0.013;
  sprite.scale.set(w * scale, h * scale, 1);
  return sprite;
}

// radialTexture lager en myk radiell glød (bålskjær, fuskeskygger, flammer).
function radialTexture(inner: string, outer: string, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// groundTexture: mørk skogbunn med varm lysning i midten og spetter av mose.
function groundTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#15281c";
  ctx.fillRect(0, 0, size, size);
  // Spetter: mose og jord i to toner.
  for (let i = 0; i < 900; i++) {
    const x = (hash(`gx${i}`) % size);
    const y = (hash(`gy${i}`) % size);
    const r = 2 + (hash(`gr${i}`) % 14);
    ctx.fillStyle = i % 3 === 0 ? "rgba(38,66,44,0.5)" : "rgba(16,30,22,0.55)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Varm lysning rundt bålet i sentrum.
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.3);
  g.addColorStop(0, "rgba(140,96,40,0.5)");
  g.addColorStop(0.5, "rgba(74,66,30,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// grassTexture: noen strå tegnet på canvas, brukt som alpha-kort på kryssplan.
function grassTexture(): THREE.CanvasTexture {
  const w = 128, h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  for (let i = 0; i < 14; i++) {
    const x = 8 + (hash(`s${i}`) % (w - 16));
    const lean = ((hash(`l${i}`) % 100) - 50) / 3.2;
    const hgt = h * (0.45 + (hash(`h${i}`) % 45) / 100);
    const grad = ctx.createLinearGradient(0, h, 0, h - hgt);
    grad.addColorStop(0, "#2c4a30");
    grad.addColorStop(1, "#6d9948");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.quadraticCurveTo(x + lean * 0.4, h - hgt * 0.6, x + lean, h - hgt);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// displaceStone forskyver vertekser med støy og maler mose på toppen som
// vertex-farger — én geometri, ett materiale, organisk steinlook.
function displaceStone(
  geo: THREE.BufferGeometry,
  seed: number,
  stone: THREE.Color,
  moss: THREE.Color,
  mossFrom = 0.25 // andel av høyden (fra toppen) som får mose
) {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  let maxY = -Infinity, minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 1.6 + seed, v.y * 1.6, v.z * 1.6 + seed);
    v.addScaledVector(v.clone().normalize(), n * 0.09);
    pos.setXYZ(i, v.x, v.y, v.z);
    maxY = Math.max(maxY, v.y);
    minY = Math.min(minY, v.y);
  }
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = (v.y - minY) / (maxY - minY);
    const edge = noise3(v.x * 4 + seed, v.y * 4, v.z * 4) * 0.1;
    // Mose der overflaten peker oppover og ligger høyt nok.
    c.copy(t + edge > 1 - mossFrom ? moss : stone);
    // Litt toneskift i steinen så den ikke blir flat.
    const shade = 0.92 + noise3(v.x * 7, v.y * 7 + seed, v.z * 7) * 0.08;
    colors[i * 3] = c.r * shade;
    colors[i * 3 + 1] = c.g * shade;
    colors[i * 3 + 2] = c.b * shade;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
}

// terrainY gir høyden på øy-toppen: flatt rundt bålet, myke koller utover,
// og faller mot null ved kanten så terrenget møter klippen pent.
function terrainY(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const inner = Math.min(1, Math.max(0, (r - 6) / 7)); // flatt nær bålet
  const edge = Math.min(1, Math.max(0, (ISLAND_R - 1 - r) / 3)); // ned mot kanten
  const rolling =
    noise3(x * 0.08, 0, z * 0.08) * 0.9 + noise3(x * 0.22, 3.7, z * 0.22) * 0.35;
  return rolling * inner * edge;
}

// Troll er ett troll i verdenen med tilstand og animasjonsdata.
interface Troll {
  agent: AgentInfo;
  group: THREE.Group;
  body: THREE.Mesh;
  nameTag: THREE.Sprite;
  bubble: THREE.Sprite | null;
  state: AgentState;
  home: THREE.Vector3;
  target: THREE.Vector3;
  phase: number;
  napAt: number;
}

const STONE_TINTS = [0xcfd4d6, 0xc9cdc6, 0xd6d2c9, 0xc4ccd2];
const MOSS_TINTS = [0x7fae3f, 0x6f9c3a, 0x8bb84a];

// buildTroll: avrundet steinkropp med mosetopp, blanke øyne, småarmer og en
// spire eller blomst på hodet — som referansene, men lette nok for nett.
function buildTroll(id: string): { group: THREE.Group; body: THREE.Mesh } {
  const h = hash(id);
  const stone = new THREE.Color(STONE_TINTS[h % STONE_TINTS.length]);
  const moss = new THREE.Color(MOSS_TINTS[(h >> 4) % MOSS_TINTS.length]);
  const group = new THREE.Group();

  // Kropp: én stein, avlang, mose på toppen. Detaljnivå 3 gir de myke,
  // "håndformede" fasettene fra referansen.
  const bodyGeo = new THREE.IcosahedronGeometry(0.62, 3);
  bodyGeo.scale(1, 1.45, 0.88);
  displaceStone(bodyGeo, (h % 100) / 10, stone, moss, 0.3);
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.95;
  group.add(body);

  // Blanke svarte øyne med hvitt lyspunkt.
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 0.12, metalness: 0.25 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xd9e6ee });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 10), eyeMat);
    eye.position.set(0.21 * side, 1.32, 0.5);
    group.add(eye);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), glintMat);
    glint.position.set(0.21 * side + 0.025, 1.35, 0.565);
    group.add(glint);
  }

  // Småarmer og føtter i samme stein.
  const limbMat = new THREE.MeshStandardMaterial({ color: stone, roughness: 0.95 });
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.3, 3, 6), limbMat);
    arm.position.set(0.62 * side, 0.85, 0.05);
    arm.rotation.z = -0.4 * side;
    group.add(arm);
    const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.16, 3, 6), limbMat);
    foot.position.set(0.24 * side, 0.14, 0.06);
    group.add(foot);
  }

  // Pynt på hodet: annenhvert troll får blomst, resten en liten spire.
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4e7d33, roughness: 0.8 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.3, 5), stemMat);
  stem.position.set(0.1, 1.92, 0);
  stem.rotation.z = -0.15;
  group.add(stem);
  if (h % 2 === 0) {
    const petalMat = new THREE.MeshStandardMaterial({ color: 0xd9695f, roughness: 0.7 });
    for (let i = 0; i < 5; i++) {
      const petal = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), petalMat);
      petal.scale.set(1, 0.4, 0.65);
      const a = (i / 5) * Math.PI * 2;
      petal.position.set(0.145 + Math.cos(a) * 0.05, 2.08, Math.sin(a) * 0.05);
      petal.rotation.y = -a;
      group.add(petal);
    }
    const center = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0xe0c04c, roughness: 0.6 })
    );
    center.position.set(0.145, 2.09, 0);
    group.add(center);
  } else {
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), stemMat);
      leaf.scale.set(1, 0.35, 0.5);
      leaf.position.set(0.1 + 0.06 * side, 2.06, 0);
      leaf.rotation.z = 0.6 * side;
      group.add(leaf);
    }
  }

  // Ekte sol-skygger: alt i trollet kaster skygge på bakken.
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });

  return { group, body };
}

// FarmScene eier alt three.js-liv. React-komponenten er bare et tynt skall.
export class FarmScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private trolls = new Map<string, Troll>();
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private accumulator = 0;
  private disposed = false;
  private canvas: HTMLCanvasElement;
  private controls!: OrbitControls;
  private downAt = new THREE.Vector2();
  private floatIsles: THREE.Mesh[] = [];
  // Innflygning: kameraet starter langt unna og glir inn mot øya.
  private flightT = 0;
  private flightFrom = new THREE.Vector3(52, 40, 62);
  private flightTo = new THREE.Vector3(0, 14, 32);

  private fireLight!: THREE.PointLight;
  private flames: THREE.Sprite[] = [];
  private fireflies!: THREE.Points;
  private fireflySeed: Float32Array = new Float32Array(0);

  onPick: ((agent: AgentInfo) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // DPR-tak: retina koster kvadratisk; 1.5 ser skarpt ut og sparer mye.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Filmisk tonemapping gir det myke, malte lyset fra referansene.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    // Ekte skygger fra kveldssola — én myk 1024-map er den største
    // realisme-gevinsten vi kan kjøpe for så lite GPU.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(FOG_COLOR, 28, 85);

    // Miljølys fra himmelen: solnedgangsgradienten brukes som IBL, så stein
    // og mose får naturlig himmelfarge i stedet for flatt konstantlys.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const equirect = skyTexture();
    equirect.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = pmrem.fromEquirectangular(equirect).texture;
    this.scene.environmentIntensity = 0.55;
    equirect.dispose();
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    // Launch: start langt unna, skrått ovenfra — innflygningen skjer i tick.
    this.camera.position.copy(this.flightFrom);

    // Fri kamerastyring: dra for å snurre, scroll for å zoome, høyreklikk
    // for å panorere. Man kan kikke litt under øya, men ikke helt rundt.
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 80;
    this.controls.maxPolarAngle = Math.PI * 0.68;
    this.controls.enabled = false; // slås på når innflygningen er ferdig
    this.controls.update();

    this.buildEnvironment();

    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointerup", this.pointerUp);
    window.addEventListener("resize", this.resize);
    this.resize();
    this.renderer.setAnimationLoop(this.tick);
  }

  // buildEnvironment reiser skogen: måneskinn, bål, trær, gress, ildfluer.
  private buildEnvironment() {
    // Lav gyllen kveldssol med lange, myke skygger; kjølig motlys fra
    // himmelhvelvet på skyggesiden, slik naturlig sprett-lys oppfører seg.
    const sun = new THREE.DirectionalLight(0xffe8c4, 2.2);
    sun.position.set(55, 68, -78);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -34;
    sun.shadow.camera.right = 34;
    sun.shadow.camera.top = 34;
    sun.shadow.camera.bottom = -34;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -0.0005;
    sun.shadow.radius = 4;
    const fill = new THREE.DirectionalLight(0x7a92b8, 0.4);
    fill.position.set(-20, 14, 24);
    const hemi = new THREE.HemisphereLight(0x7f9cc0, 0x2a2418, 0.35);
    this.scene.add(sun, fill, hemi);

    this.fireLight = new THREE.PointLight(0xff9a3d, 60, 26, 2);
    this.fireLight.position.set(0, 1.4, 0);
    this.scene.add(this.fireLight);

    // Øy-toppen: gressflata trollene bor på, med myke koller fra terrainY.
    // (Geometrien ligger i XY-planet og roteres ned; verdens-z = -geometri-y,
    // så høyden skrives til geometri-z før rotasjonen.)
    // RingGeometry (nesten-null indre radius) gir et rutenett av ringer å
    // forme koller i — CircleGeometry er bare en vifte uten indre punkter.
    const groundGeo = new THREE.RingGeometry(0.02, ISLAND_R, 96, 28);
    {
      const pos = groundGeo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        pos.setZ(i, terrainY(pos.getX(i), -pos.getY(i)));
      }
      groundGeo.computeVertexNormals();
    }
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Undersiden: en støyforskjøvet stein-kjegle som henger under øya, med
    // jordkant øverst, fjell i midten og mørk spiss nederst.
    const DEPTH = 24;
    const under = new THREE.ConeGeometry(ISLAND_R, DEPTH, 48, 9, true);
    under.rotateX(Math.PI);
    under.translate(0, -DEPTH / 2, 0);
    {
      const pos = under.getAttribute("position") as THREE.BufferAttribute;
      const colors = new Float32Array(pos.count * 3);
      const v = new THREE.Vector3();
      const dirt = new THREE.Color(0x54452e);
      const rock = new THREE.Color(0x63666a);
      const deep = new THREE.Color(0x35383e);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const d = -v.y / DEPTH; // 0 ved kanten, 1 ved spissen
        const n = noise3(v.x * 0.35, v.y * 0.5, v.z * 0.35);
        // Horisontal støy gir klippeprofil; kanten (d≈0) holdes flush.
        const bulge = 1 + n * 0.16 * Math.min(1, d * 3);
        pos.setXYZ(i, v.x * bulge, v.y + n * 0.6 * d, v.z * bulge);
        if (d < 0.08) c.copy(dirt);
        else c.copy(rock).lerp(deep, Math.min(1, d * 1.15));
        const shade = 0.88 + noise3(v.x * 2.1, v.y * 2.1, v.z * 2.1) * 0.12;
        colors[i * 3] = c.r * shade;
        colors[i * 3 + 1] = c.g * shade;
        colors[i * 3 + 2] = c.b * shade;
      }
      under.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      under.computeVertexNormals();
    }
    this.scene.add(
      new THREE.Mesh(under, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98 }))
    );

    const rimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

    // Småøyer som svever rundt hovedøya og duver sakte (animeres i tick).
    for (let i = 0; i < 5; i++) {
      const size = 1.2 + (hash(`fi${i}`) % 100) / 60;
      const geo = new THREE.IcosahedronGeometry(size, 2);
      geo.scale(1, 0.75, 1);
      displaceStone(geo, i * 7.3, new THREE.Color(0x63666a), new THREE.Color(0x6d9c3f), 0.32);
      const isle = new THREE.Mesh(geo, rimMat);
      const a = (hash(`fia${i}`) % 628) / 100;
      const r = ISLAND_R + 10 + (hash(`fir${i}`) % 140) / 10;
      isle.position.set(Math.cos(a) * r, -3 + (hash(`fiy${i}`) % 120) / 10, Math.sin(a) * r);
      this.floatIsles.push(isle);
      this.scene.add(isle);
    }

    // Bålet: steinring, vedkubber, flammer og glød på bakken.
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6b6f72, roughness: 0.9 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16 + (hash(`fs${i}`) % 10) / 80, 0), stoneMat);
      s.position.set(Math.cos(a) * 0.85, 0.1, Math.sin(a) * 0.85);
      s.rotation.y = a * 3;
      this.scene.add(s);
    }
    const logMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95 });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.9, 6), logMat);
      log.rotation.set(Math.PI / 2.3, 0, (i / 3) * Math.PI);
      log.position.y = 0.16;
      this.scene.add(log);
    }
    const flameTex = radialTexture("rgba(255,214,140,0.95)", "rgba(255,120,20,0)");
    for (let i = 0; i < 3; i++) {
      const flame = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: flameTex,
          color: i === 0 ? 0xffd88c : 0xff9a3d,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        })
      );
      flame.position.set(0, 0.55 + i * 0.25, 0);
      flame.scale.setScalar(1.1 - i * 0.28);
      this.flames.push(flame);
      this.scene.add(flame);
    }
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({
        map: radialTexture("rgba(255,150,60,0.28)", "rgba(255,150,60,0)"),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.03;
    this.scene.add(glow);

    // (Trærne er tatt ut inntil videre — åpen slette gir trollene mer plass.)
    const m = new THREE.Matrix4();

    // Gresstuster: instanserte kryssplan med alpha-strå, tettest nær bålet.
    const grassTex = grassTexture();
    const grassGeo = new THREE.PlaneGeometry(0.9, 0.7);
    grassGeo.translate(0, 0.35, 0);
    const grassMat = new THREE.MeshLambertMaterial({
      map: grassTex,
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
    });
    // Tett eng: én instansert mesh = ett draw call uansett antall tuster.
    // Kvadratrot-fordeling gir jevn tetthet helt ut til kanten.
    const G = 3200;
    const grass = new THREE.InstancedMesh(grassGeo, grassMat, G * 2);
    const tint = new THREE.Color();
    for (let i = 0; i < G; i++) {
      const a = (hash(`ga${i}`) % 628) / 100;
      const r = 1.6 + Math.sqrt((hash(`gd${i}`) % 1000) / 1000) * (ISLAND_R - 2.8);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = terrainY(x, z);
      const s = 0.7 + (hash(`gs${i}`) % 100) / 140;
      // Naturlig fargevariasjon: hver tust har sin egen grønntone.
      tint.setHSL(
        0.26 + ((hash(`gh${i}`) % 100) / 100) * 0.05,
        0.42,
        0.32 + ((hash(`gl${i}`) % 100) / 100) * 0.16
      );
      for (let c = 0; c < 2; c++) {
        m.makeRotationY(a * 5 + c * Math.PI / 2);
        m.scale(new THREE.Vector3(s, s, s));
        m.setPosition(x, y, z);
        grass.setMatrixAt(i * 2 + c, m);
        grass.setColorAt(i * 2 + c, tint);
      }
    }
    grass.receiveShadow = true;
    this.scene.add(grass);

    // Blomster i gresset: hvite, gule og røde, instansert per farge.
    const flowerColors = [0xe0e8de, 0xd9b84c, 0xc96a55];
    const flowerGeo = new THREE.SphereGeometry(0.05, 5, 4);
    for (let ci = 0; ci < flowerColors.length; ci++) {
      const F = 26;
      const flowers = new THREE.InstancedMesh(
        flowerGeo,
        new THREE.MeshStandardMaterial({ color: flowerColors[ci], roughness: 0.7 }),
        F
      );
      for (let i = 0; i < F; i++) {
        const a = (hash(`fa${ci}-${i}`) % 628) / 100;
        const r = 3 + (hash(`fr${ci}-${i}`) % 230) / 10;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        m.makeScale(1, 1, 1);
        m.setPosition(x, terrainY(x, z) + 0.3, z);
        flowers.setMatrixAt(i, m);
      }
      this.scene.add(flowers);
    }

    // Busker: klaser av mosegrønne, støyforskjøvne kuler — lav vegetasjon
    // som gir øya dybde uten å stjele utsikten.
    for (let i = 0; i < 16; i++) {
      const bush = new THREE.Group();
      const parts = 2 + (hash(`bp${i}`) % 3);
      const mossTone = new THREE.Color(MOSS_TINTS[(hash(`bm${i}`) >> 2) % MOSS_TINTS.length]);
      for (let p = 0; p < parts; p++) {
        const size = 0.35 + (hash(`bs${i}-${p}`) % 100) / 220;
        const geo = new THREE.IcosahedronGeometry(size, 2);
        displaceStone(geo, i * 2.9 + p, mossTone, mossTone.clone().offsetHSL(0, 0.05, 0.06), 0.9);
        const part = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 })
        );
        part.position.set(
          ((hash(`bx${i}-${p}`) % 100) - 50) / 90,
          size * 0.55,
          ((hash(`bz${i}-${p}`) % 100) - 50) / 90
        );
        part.castShadow = true;
        bush.add(part);
      }
      const a = (hash(`ba${i}`) % 628) / 100;
      const r = 6 + (hash(`br${i}`) % 200) / 10;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      bush.position.set(x, terrainY(x, z), z);
      this.scene.add(bush);
    }

    // Ildfluer: additive punkter som driver sakte rundt i lysningen.
    const N = 70;
    const positions = new Float32Array(N * 3);
    this.fireflySeed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = (hash(`ffa${i}`) % 628) / 100;
      const r = 4 + (hash(`ffr${i}`) % 280) / 10;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 0.6 + (hash(`ffy${i}`) % 100) / 28;
      positions[i * 3 + 2] = Math.sin(a) * r;
      this.fireflySeed[i * 3] = (hash(`fsx${i}`) % 100) / 16;
      this.fireflySeed[i * 3 + 1] = (hash(`fsy${i}`) % 100) / 16;
      this.fireflySeed[i * 3 + 2] = (hash(`fsz${i}`) % 100) / 16;
    }
    const ffGeo = new THREE.BufferGeometry();
    ffGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.fireflies = new THREE.Points(
      ffGeo,
      new THREE.PointsMaterial({
        map: radialTexture("rgba(216,255,150,1)", "rgba(216,255,150,0)", 64),
        color: 0xcdf27d,
        size: 0.22,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.scene.add(this.fireflies);
  }

  // syncAgents oppdaterer trollbestanden mot ferske agent-data.
  syncAgents(agents: AgentInfo[]) {
    const seen = new Set<string>();
    for (const agent of agents) {
      seen.add(agent.id);
      const existing = this.trolls.get(agent.id);
      if (existing) {
        existing.agent = agent;
        const state = agent.state ?? "sleeping";
        if (state !== existing.state) this.setState(existing, state);
        if (agent.name !== existing.nameTag.userData.text) this.setName(existing, agent.name);
        continue;
      }
      this.spawn(agent);
    }
    for (const [id, troll] of this.trolls) {
      if (!seen.has(id)) {
        this.scene.remove(troll.group);
        this.trolls.delete(id);
      }
    }
  }

  private spawn(agent: AgentInfo) {
    const h = hash(agent.id);
    const { group, body } = buildTroll(agent.id);

    // Stabil plass i en ring rundt bålet, vendt inn mot varmen.
    const idx = this.trolls.size;
    const angle = (h % 628) / 100;
    const radius = 4 + (idx % 8) * 2.4 + ((h >> 8) % 10) / 6;
    const hx = Math.cos(angle) * radius;
    const hz = Math.sin(angle) * radius;
    const home = new THREE.Vector3(hx, terrainY(hx, hz), hz);
    group.position.copy(home);
    group.rotation.y = Math.atan2(-home.x, -home.z);

    const nameTag = textSprite(agent.name || "Troll", { bg: "rgba(10,20,16,0.45)", scale: 0.0055 });
    nameTag.position.y = 2.3;
    nameTag.userData.text = agent.name;
    group.add(nameTag);

    group.userData.agentId = agent.id;
    group.traverse((o) => (o.userData.agentId = agent.id));

    this.scene.add(group);
    const troll: Troll = {
      agent,
      group,
      body,
      nameTag,
      bubble: null,
      state: "sleeping",
      home,
      target: home.clone(),
      phase: (h % 100) / 16,
      napAt: 0,
    };
    this.trolls.set(agent.id, troll);
    this.setState(troll, agent.state ?? "sleeping");
  }

  private setName(troll: Troll, name: string) {
    troll.group.remove(troll.nameTag);
    troll.nameTag = textSprite(name || "Troll", { bg: "rgba(10,20,16,0.45)", scale: 0.0055 });
    troll.nameTag.position.y = 2.3;
    troll.nameTag.userData.text = name;
    troll.group.add(troll.nameTag);
  }

  // setState bytter boble og grunnstilling; bevegelsen skjer i tick.
  private setState(troll: Troll, state: AgentState) {
    troll.state = state;
    if (troll.bubble) {
      troll.group.remove(troll.bubble);
      troll.bubble = null;
    }
    // Ingen aktivitetsbobler — tilstanden leses av kroppsspråket alene.
    troll.group.rotation.z = state === "broken" ? Math.PI / 2.4 : 0;
    troll.group.scale.setScalar(state === "paused" ? 0.85 : 1);
    // Pausede/ødelagte troll mister fargen: mose og stein gråner.
    const mat = troll.body.material as THREE.MeshStandardMaterial;
    const dim = state === "broken" || state === "paused";
    mat.color.setHex(dim ? 0x777672 : 0xffffff);
  }

  // tick animerer med FPS-tak, og hopper helt over når fanen er skjult.
  private tick = () => {
    if (this.disposed || document.hidden) return;
    this.accumulator += this.clock.getDelta();
    if (this.accumulator < 1 / FPS_CAP) return;
    const dt = Math.min(this.accumulator, 0.1);
    this.accumulator = 0;
    const t = this.clock.elapsedTime;

    // Innflygning: myk easing fra launch-punktet inn til øya, så fri styring.
    if (this.flightT < 1) {
      this.flightT = Math.min(1, this.flightT + dt / 3);
      const e = this.flightT * this.flightT * (3 - 2 * this.flightT); // smoothstep
      this.camera.position.lerpVectors(this.flightFrom, this.flightTo, e);
      this.camera.lookAt(this.controls.target);
      if (this.flightT >= 1) this.controls.enabled = true;
    }
    this.controls.update();

    // Småøyene duver sakte.
    for (let i = 0; i < this.floatIsles.length; i++) {
      const isle = this.floatIsles[i];
      isle.position.y += Math.sin(t * 0.35 + i * 1.9) * 0.004;
      isle.rotation.y += 0.0006;
    }

    // Bålet flakrer: lys og flammer i utakt.
    this.fireLight.intensity = 52 + Math.sin(t * 9) * 6 + Math.sin(t * 23.7) * 4;
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const s = (1.1 - i * 0.28) * (1 + Math.sin(t * (7 + i * 3.1)) * 0.09);
      f.scale.set(s * (1 + Math.sin(t * 11 + i) * 0.06), s * (1 + Math.cos(t * 8 + i) * 0.1), 1);
      f.position.y = 0.55 + i * 0.25 + Math.sin(t * 6 + i * 2) * 0.03;
    }

    // Ildfluer driver og blinker.
    const pos = this.fireflies.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const sx = this.fireflySeed[i * 3];
      const sy = this.fireflySeed[i * 3 + 1];
      const sz = this.fireflySeed[i * 3 + 2];
      pos.setX(i, pos.getX(i) + Math.sin(t * 0.4 + sx) * 0.004);
      pos.setY(i, pos.getY(i) + Math.cos(t * 0.55 + sy) * 0.0035);
      pos.setZ(i, pos.getZ(i) + Math.sin(t * 0.47 + sz) * 0.004);
    }
    pos.needsUpdate = true;
    // Dagslys: ildfluene er bare et svakt glimt til skumringen kommer.
    (this.fireflies.material as THREE.PointsMaterial).opacity = 0.28 + Math.sin(t * 1.8) * 0.12;

    for (const troll of this.trolls.values()) {
      const { group } = troll;
      const p = troll.phase;
      switch (troll.state) {
        case "sleeping": {
          group.scale.y = 1 + Math.sin(t * 1.2 + p) * 0.02;
          if (t > troll.napAt) {
            const a = (hash(`${troll.agent.id}-${Math.floor(t / 9)}`) % 628) / 100;
            troll.target.set(
              troll.home.x + Math.cos(a) * 1.6,
              0,
              troll.home.z + Math.sin(a) * 1.6
            );
            troll.napAt = t + 6 + (p % 5);
          }
          this.walkToward(troll, dt, 0.4);
          break;
        }
        case "thinking":
          group.rotation.y += Math.sin(t * 0.8 + p) * 0.004;
          group.position.y =
            terrainY(group.position.x, group.position.z) +
            Math.abs(Math.sin(t * 1.6 + p)) * 0.03;
          if (troll.bubble) troll.bubble.position.y = 3.1 + Math.sin(t * 2 + p) * 0.08;
          break;
        case "working":
          group.position.y =
            terrainY(group.position.x, group.position.z) +
            Math.abs(Math.sin(t * 7 + p)) * 0.06;
          if (troll.bubble) troll.bubble.rotation.z = Math.sin(t * 9 + p) * 0.12;
          break;
        case "broken":
          group.rotation.z = Math.PI / 2.4 + Math.sin(t * 2 + p) * 0.015;
          break;
        case "paused":
          break;
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  private walkToward(troll: Troll, dt: number, speed: number) {
    const pos = troll.group.position;
    const dir = new THREE.Vector3().subVectors(troll.target, pos);
    dir.y = 0;
    const dist = dir.length();
    if (dist < 0.05) return;
    dir.normalize();
    pos.addScaledVector(dir, Math.min(speed * dt, dist));
    troll.group.rotation.y = Math.atan2(dir.x, dir.z);
    troll.group.position.y =
      terrainY(pos.x, pos.z) +
      Math.abs(Math.sin(this.clock.elapsedTime * 8 + troll.phase)) * 0.05;
  }

  // Klikk vs. dra: plukk kun når pekeren knapt har flyttet seg, ellers er
  // det kamerastyring.
  private pointerDown = (e: PointerEvent) => {
    this.downAt.set(e.clientX, e.clientY);
  };

  private pointerUp = (e: PointerEvent) => {
    if (this.downAt.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) < 6) {
      this.handlePick(e);
    }
  };

  private handlePick = (e: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(
      [...this.trolls.values()].map((t) => t.group),
      true
    );
    const id = hits[0]?.object.userData.agentId;
    if (id && this.onPick) {
      const troll = this.trolls.get(id);
      if (troll) this.onPick(troll.agent);
    }
  };

  private resize = () => {
    const { clientWidth, clientHeight } = this.canvas.parentElement ?? this.canvas;
    if (!clientWidth || !clientHeight) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  };

  // dispose rydder ALT — GPU-buffere, teksturer, lyttere.
  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    window.removeEventListener("resize", this.resize);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if ("map" in m) (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        });
      }
      if (o instanceof THREE.Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    this.renderer.dispose();
  }
}
