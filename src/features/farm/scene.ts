// Farmen, minimal utgave: et sort gulv, skapningene, mykt lys. All verden
// (øy, gress, bål, himmel) er bevisst strippet — den ligger i git-historikken
// og kan hentes tilbake når grunnopplevelsen sitter.
//
// Rendering holdes fortsatt hardt i tøylene: FPS-tak, DPR-tak, pause når
// fanen er skjult, full opprydding ved unmount.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AgentInfo, AgentState } from "../../lib/api";

const FPS_CAP = 30;

// hash gir et stabilt tall fra en streng — plass og tone følger agent-id.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// textSprite tegner tekst på canvas → sprite (navneskiltene).
function textSprite(text: string): THREE.Sprite {
  const size = 44;
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
  c2.fillStyle = "rgba(16,16,18,0.55)";
  c2.beginPath();
  c2.roundRect(0, 0, w, h, 12);
  c2.fill();
  c2.font = `600 ${size}px system-ui, sans-serif`;
  c2.fillStyle = "#e6e6e2";
  c2.textAlign = "center";
  c2.textBaseline = "middle";
  c2.fillText(text, w / 2, h / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  );
  const scale = 0.0055;
  sprite.scale.set(w * scale, h * scale, 1);
  return sprite;
}

// Troll er én skapning i verdenen med tilstand og animasjonsdata.
interface Troll {
  agent: AgentInfo;
  group: THREE.Group;
  body: THREE.Mesh;
  nameTag: THREE.Sprite;
  state: AgentState;
  home: THREE.Vector3;
  target: THREE.Vector3;
  phase: number;
  napAt: number;
}

// Enkel prosedyral fallback hvis GLB-modellene ikke lar seg laste: en
// avrundet stein med øyne. Bevisst anonym — Blender-modellene er de ekte.
function buildFallback(id: string): { group: THREE.Group; body: THREE.Mesh; height: number } {
  const h = hash(id);
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(((h % 60) / 60) * 0.1 + 0.05, 0.12, 0.5),
    roughness: 0.9,
  });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 2), mat);
  body.scale.set(1, 1.3, 0.9);
  body.position.y = 0.8;
  body.castShadow = true;
  group.add(body);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat);
    eye.position.set(0.18 * side, 1.05, 0.5);
    group.add(eye);
  }
  return { group, body, height: 2.1 };
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

  // Blender-modellene; til de er forsøkt lastet holdes spawning tilbake.
  private models: { troll?: THREE.Group; golem?: THREE.Group } = {};
  private modelsTried = false;
  private pendingAgents: AgentInfo[] | null = null;

  onPick: ((agent: AgentInfo) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene.background = new THREE.Color(0x0a0a0c);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.set(0, 14, 26);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 60;
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.controls.update();

    // Ingen verden i det hele tatt — skapningene svever i mørket.
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(14, 22, 10);
    const fill = new THREE.HemisphereLight(0x3a3f4a, 0x0a0a0c, 0.5);
    this.scene.add(key, fill);

    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointerup", this.pointerUp);
    window.addEventListener("resize", this.resize);
    this.resize();
    this.renderer.setAnimationLoop(this.tick);
    this.loadModels();
  }

  private async loadModels() {
    const loader = new GLTFLoader();
    const [troll, golem] = await Promise.allSettled([
      loader.loadAsync("/farm/troll.glb"),
      loader.loadAsync("/farm/golem.glb"),
    ]);
    if (troll.status === "fulfilled") this.models.troll = troll.value.scene;
    if (golem.status === "fulfilled") this.models.golem = golem.value.scene;
    this.modelsTried = true;
    if (this.pendingAgents) {
      const agents = this.pendingAgents;
      this.pendingAgents = null;
      this.syncAgents(agents);
    }
  }

  // syncAgents oppdaterer bestanden mot ferske agent-data.
  syncAgents(agents: AgentInfo[]) {
    if (!this.modelsTried) {
      this.pendingAgents = agents;
      return;
    }
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
    const golem = h % 2 === 1;
    const model = golem ? this.models.golem : this.models.troll;

    let built: { group: THREE.Group; body: THREE.Mesh; height: number };
    if (model) {
      const group = model.clone(true);
      let rockMesh: THREE.Mesh | null = null;
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.castShadow = true;
        const mat = o.material as THREE.MeshStandardMaterial;
        if (mat.name === "GolemRock" || mat.name === "TrollRock") {
          // Egen materialkopi per agent: liten individuell fargetone.
          const own = mat.clone();
          own.color.offsetHSL(((h % 20) - 10) / 500, 0, ((h >> 6) % 10) / 300);
          o.material = own;
          rockMesh = o;
        }
      });
      const body = rockMesh ?? (group.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh);
      built = { group, body, height: golem ? 3.1 : 2.7 };
    } else {
      built = buildFallback(agent.id);
    }
    const { group, body } = built;

    // Stabil plass i en ring, vendt mot midten.
    const idx = this.trolls.size;
    const angle = (h % 628) / 100;
    const radius = 4 + (idx % 8) * 2.4 + ((h >> 8) % 10) / 6;
    const home = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    group.position.copy(home);
    group.rotation.y = Math.atan2(-home.x, -home.z);

    const nameTag = textSprite(agent.name || "Troll");
    nameTag.position.y = built.height;
    nameTag.userData.text = agent.name;
    nameTag.userData.height = built.height;
    group.add(nameTag);

    group.userData.agentId = agent.id;
    group.traverse((o) => (o.userData.agentId = agent.id));

    this.scene.add(group);
    const troll: Troll = {
      agent,
      group,
      body,
      nameTag,
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
    const height = (troll.nameTag.userData.height as number) ?? 2.3;
    troll.group.remove(troll.nameTag);
    troll.nameTag = textSprite(name || "Troll");
    troll.nameTag.position.y = height;
    troll.nameTag.userData.text = name;
    troll.nameTag.userData.height = height;
    troll.group.add(troll.nameTag);
  }

  // setState: tilstanden leses av kroppsspråket (animasjonen i tick) og en
  // dimming av ødelagte/pausede skapninger.
  private setState(troll: Troll, state: AgentState) {
    troll.state = state;
    troll.group.rotation.z = state === "broken" ? Math.PI / 2.4 : 0;
    troll.group.scale.setScalar(state === "paused" ? 0.85 : 1);
    const mat = troll.body.material as THREE.MeshStandardMaterial;
    const dim = state === "broken" || state === "paused";
    mat.color.setHex(dim ? 0x55555a : 0xffffff);
  }

  // tick animerer med FPS-tak, og hopper helt over når fanen er skjult.
  private tick = () => {
    if (this.disposed || document.hidden) return;
    this.accumulator += this.clock.getDelta();
    if (this.accumulator < 1 / FPS_CAP) return;
    const dt = Math.min(this.accumulator, 0.1);
    this.accumulator = 0;
    const t = this.clock.elapsedTime;
    this.controls.update();

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
          group.position.y = Math.abs(Math.sin(t * 1.6 + p)) * 0.03;
          break;
        case "working":
          group.position.y = Math.abs(Math.sin(t * 7 + p)) * 0.06;
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
    troll.group.position.y = Math.abs(Math.sin(this.clock.elapsedTime * 8 + troll.phase)) * 0.05;
  }

  // Klikk vs. dra: plukk kun når pekeren knapt har flyttet seg.
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
