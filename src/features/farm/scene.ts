// Trollskogen: lavpoly 3D-verden der agentene lever som troll. Bygget rett på
// three.js (ingen react-three-fiber) så render-løkka kan styres hardt:
// FPS-tak, pause når fanen er skjult, og full opprydding ved unmount.
import * as THREE from "three";
import type { AgentInfo, AgentState } from "../../lib/api";

const FPS_CAP = 30;
const WORLD_RADIUS = 26;

// Jordnær indie-palett for trollkropper (velges stabilt fra agent-id).
const TROLL_COLORS = [0x7a8c5c, 0x8c6e54, 0x6b7f8c, 0x8c7a9e, 0x5c8c7d, 0xa08858];
const GROUND = 0x4d6b45;
const GROUND_DARK = 0x40593a;

// hash gir et stabilt tall fra en streng — posisjon og farge følger agent-id,
// så trollet står på samme sted hver gang.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// textSprite tegner tekst på et canvas og gir en sprite (navneskilt/bobler).
function textSprite(text: string, opts?: { size?: number; color?: string; bg?: string }): THREE.Sprite {
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
  c2.fillStyle = opts?.color ?? "#f5f2e8";
  c2.textAlign = "center";
  c2.textBaseline = "middle";
  c2.fillText(text, w / 2, h / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  );
  const scale = 0.014;
  sprite.scale.set(w * scale, h * scale, 1);
  return sprite;
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
  phase: number; // faseforskyvning så trollene ikke er synkrone
  napAt: number; // når et sovende troll rusler/legger seg igjen (visuell variasjon)
}

// buildTroll setter sammen et lavpoly-troll. Flat shading + få polygoner er
// hele estetikken — og billig å tegne.
function buildTroll(color: number): { group: THREE.Group; body: THREE.Mesh } {
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9c9a8, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2e2a24, flatShading: true });

  const group = new THREE.Group();

  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), mat);
  body.position.y = 0.55;
  body.scale.set(1, 1.15, 0.9);
  group.add(body);

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), mat);
  head.position.y = 1.3;
  group.add(head);

  const nose = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), skin);
  nose.position.set(0, 1.26, 0.32);
  group.add(nose);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), dark);
    eye.position.set(0.13 * side, 1.36, 0.28);
    group.add(eye);

    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 4), mat);
    ear.position.set(0.34 * side, 1.42, 0);
    ear.rotation.z = -0.9 * side;
    group.add(ear);

    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.35, 2, 5), mat);
    arm.position.set(0.55 * side, 0.75, 0);
    arm.rotation.z = -0.5 * side;
    group.add(arm);

    const foot = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), skin);
    foot.position.set(0.22 * side, 0.08, 0.1);
    group.add(foot);
  }

  const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 5), dark);
  tuft.position.y = 1.62;
  tuft.rotation.z = 0.25;
  group.add(tuft);

  // Myk fuskeskygge — mye billigere enn ekte skyggekart.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  return { group, body };
}

// scatter plasserer pynt (trær, steiner, sopp) stabilt utover marka.
function scatter(scene: THREE.Scene, seed: number) {
  const treeMat = new THREE.MeshLambertMaterial({ color: 0x3d5c38, flatShading: true });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c4a38, flatShading: true });
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x7d7a70, flatShading: true });
  const rnd = (i: number, salt: number) =>
    (hash(`${seed}-${i}-${salt}`) % 1000) / 1000;

  for (let i = 0; i < 26; i++) {
    const angle = rnd(i, 1) * Math.PI * 2;
    // Pynten legges i utkanten så trollene får plassen i midten.
    const r = WORLD_RADIUS * (0.72 + rnd(i, 2) * 0.35);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (i % 3 === 2) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + rnd(i, 3), 0), rockMat);
      rock.position.set(x, 0.3, z);
      rock.rotation.y = rnd(i, 4) * Math.PI;
      scene.add(rock);
    } else {
      const tree = new THREE.Group();
      const h = 2.2 + rnd(i, 5) * 2;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, h * 0.35, 5), trunkMat);
      trunk.position.y = h * 0.17;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.9 + rnd(i, 6) * 0.5, h * 0.8, 6), treeMat);
      crown.position.y = h * 0.35 + h * 0.4;
      tree.add(trunk, crown);
      tree.position.set(x, 0, z);
      scene.add(tree);
    }
  }
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
  private frame = 0;

  onPick: ((agent: AgentInfo) => void) | null = null;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // DPR-tak: retina koster kvadratisk, og lavpoly ser fint ut på 1.5.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0x8fb3c7);
    this.scene.fog = new THREE.Fog(0x8fb3c7, 30, 70);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
    this.camera.position.set(0, 16, 26);
    this.camera.lookAt(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xdaeaf2, 0x40593a, 1.1);
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.4);
    sun.position.set(12, 20, 8);
    this.scene.add(hemi, sun);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(WORLD_RADIUS + 14, 40),
      new THREE.MeshLambertMaterial({ color: GROUND })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // Litt ujevne gresstuster gir dybde uten flere lyskilder.
    const patchMat = new THREE.MeshLambertMaterial({ color: GROUND_DARK });
    for (let i = 0; i < 18; i++) {
      const patch = new THREE.Mesh(new THREE.CircleGeometry(1 + (hash(`p${i}`) % 20) / 10, 10), patchMat);
      patch.rotation.x = -Math.PI / 2;
      const a = (hash(`pa${i}`) % 628) / 100;
      const r = (hash(`pr${i}`) % (WORLD_RADIUS * 10)) / 10;
      patch.position.set(Math.cos(a) * r, 0.01, Math.sin(a) * r);
      this.scene.add(patch);
    }
    scatter(this.scene, 7);

    canvas.addEventListener("pointerdown", this.handlePick);
    window.addEventListener("resize", this.resize);
    this.resize();
    this.renderer.setAnimationLoop(this.tick);
  }

  // syncAgents oppdaterer trollbestanden mot ferske agent-data: nye troll
  // fødes, slettede fjernes, tilstander og navn oppdateres in place.
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
    const color = TROLL_COLORS[h % TROLL_COLORS.length];
    const { group, body } = buildTroll(color);

    // Stabil hjemmeplass i en spiral rundt sentrum.
    const idx = this.trolls.size;
    const angle = (h % 628) / 100;
    const radius = 3 + (idx % 7) * 2.4 + ((h >> 8) % 10) / 6;
    const home = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    group.position.copy(home);
    group.rotation.y = (h % 314) / 50;

    const nameTag = textSprite(agent.name || "Troll");
    nameTag.position.y = 2.15;
    nameTag.userData.text = agent.name;
    group.add(nameTag);

    // Klikk-plukking treffer alt i gruppa; agent-id ligger på rota.
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
    troll.nameTag = textSprite(name || "Troll");
    troll.nameTag.position.y = 2.15;
    troll.nameTag.userData.text = name;
    troll.group.add(troll.nameTag);
  }

  // setState bytter boble og grunnstilling. Selve bevegelsen skjer i tick.
  private setState(troll: Troll, state: AgentState) {
    troll.state = state;
    if (troll.bubble) {
      troll.group.remove(troll.bubble);
      troll.bubble = null;
    }
    const bubbleFor: Partial<Record<AgentState, [string, string]>> = {
      sleeping: ["z Z", "#dbe8f0"],
      thinking: ["…", "#f2e8c9"],
      working: ["✎", "#d9ead3"],
      broken: ["!", "#f0c9c9"],
    };
    const spec = bubbleFor[state];
    if (spec) {
      troll.bubble = textSprite(spec[0], { size: 52, color: "#3a3630", bg: spec[1] });
      troll.bubble.position.set(0.55, 2.7, 0);
      troll.group.add(troll.bubble);
    }
    // Grunnstilling: pauset troll sitter (flatere), ødelagt ligger på siden.
    troll.group.rotation.z = state === "broken" ? Math.PI / 2.4 : 0;
    troll.group.scale.setScalar(state === "paused" ? 0.85 : 1);
    (troll.body.material as THREE.MeshLambertMaterial).color.setHex(
      state === "broken" || state === "paused"
        ? 0x8a8a82
        : TROLL_COLORS[hash(troll.agent.id) % TROLL_COLORS.length]
    );
  }

  // tick kjører animasjonen med FPS-tak — og hopper helt over når fanen er
  // skjult, så en åpen farm i bakgrunnen koster ~ingenting.
  private tick = () => {
    if (this.disposed || document.hidden) return;
    this.accumulator += this.clock.getDelta();
    if (this.accumulator < 1 / FPS_CAP) return;
    const dt = Math.min(this.accumulator, 0.1);
    this.accumulator = 0;
    this.frame++;
    const t = this.clock.elapsedTime;

    for (const troll of this.trolls.values()) {
      const { group } = troll;
      const p = troll.phase;
      switch (troll.state) {
        case "sleeping": {
          // Rolig pust, og en liten rusletur innimellom så marka lever.
          group.scale.y = 1 + Math.sin(t * 1.2 + p) * 0.02;
          if (t > troll.napAt) {
            const a = (hash(`${troll.agent.id}-${Math.floor(t / 9)}`) % 628) / 100;
            troll.target.set(
              troll.home.x + Math.cos(a) * 1.8,
              0,
              troll.home.z + Math.sin(a) * 1.8
            );
            troll.napAt = t + 6 + (p % 5);
          }
          this.walkToward(troll, dt, 0.45);
          break;
        }
        case "thinking":
          // Grubler: vugger sakte fra side til side.
          group.rotation.y += Math.sin(t * 0.8 + p) * 0.004;
          group.position.y = Math.abs(Math.sin(t * 1.6 + p)) * 0.03;
          if (troll.bubble) troll.bubble.position.y = 2.7 + Math.sin(t * 2 + p) * 0.08;
          break;
        case "working":
          // Skriver: rask liten nikking, boblen dirrer.
          group.position.y = Math.abs(Math.sin(t * 7 + p)) * 0.06;
          if (troll.bubble) troll.bubble.rotation.z = Math.sin(t * 9 + p) * 0.12;
          break;
        case "broken":
          // Ligger og ynker seg svakt.
          group.rotation.z = Math.PI / 2.4 + Math.sin(t * 2 + p) * 0.015;
          break;
        case "paused":
          break; // helt stille
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
    // Trippetrinn mens den går.
    troll.group.position.y = Math.abs(Math.sin(this.clock.elapsedTime * 8 + troll.phase)) * 0.05;
  }

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

  // dispose rydder ALT — GPU-buffere, teksturer, lyttere — så det å lukke
  // farmen gir tilbake hver eneste byte.
  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.canvas.removeEventListener("pointerdown", this.handlePick);
    window.removeEventListener("resize", this.resize);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m instanceof THREE.SpriteMaterial || m instanceof THREE.MeshBasicMaterial) m.map?.dispose();
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
