// AOM · scroll-driven scene: data blocks fly in from every side, assemble into a database,
// then regroup into an HA pair and finally an HA + DR (two-site) architecture.
import * as THREE from './vendor/three.module.min.js';

const canvas = document.getElementById('scene');
const labelLayer = document.getElementById('labels');
const hudIdx = document.getElementById('hud-idx');
const hudName = document.getElementById('hud-name');
const hudBar = document.getElementById('hud-bar');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
	document.documentElement.classList.add('no-webgl');
	throw e;
}

const N = 1600;     // data blocks
const SP = 0.27;    // spacing between blocks
const CUBE = 0.2;   // block edge

// ---------- helpers ----------
function rng(seed) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rand = rng(11);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (t) => t * t * (3 - 2 * t);

const COL = {
	deep: new THREE.Color('#1d3f9e'),
	mid: new THREE.Color('#2f6ae0'),
	high: new THREE.Color('#8cc8fb'),
	tile: new THREE.Color('#122650'),
	dust: new THREE.Color('#4f7fd6'),
	lit: new THREE.Color('#e3f2ff'),
};

// ---------- formation builder ----------
class Formation {
	constructor() { this.items = []; this.labels = []; this.links = []; }
	cube(x, y, z, s = CUBE) { this.items.push({ x, y, z, sx: s, sy: s, sz: s, kind: 'solid' }); }
	tile(x, y, z, s) { this.items.push({ x, y, z, sx: s, sy: 0.07, sz: s, kind: 'tile' }); }
	cylinder(cx, cz, r, disks = 3, layers = 3, gap = 0.3) {
		const n = Math.max(8, Math.round((2 * Math.PI * r) / SP));
		for (let d = 0; d < disks; d++) {
			for (let l = 0; l < layers; l++) {
				const y = d * (layers * SP + gap) + l * SP;
				for (let k = 0; k < n; k++) {
					const a = ((k + (l % 2) * 0.5) / n) * Math.PI * 2;
					this.cube(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
				}
			}
		}
		const top = (disks - 1) * (layers * SP + gap) + (layers - 1) * SP;
		this.cube(cx, top, cz);
		for (let rr = SP; rr < r - SP * 0.5; rr += SP) {
			const m = Math.round((2 * Math.PI * rr) / SP);
			for (let k = 0; k < m; k++) {
				const a = (k / m) * Math.PI * 2;
				this.cube(cx + Math.cos(a) * rr, top, cz + Math.sin(a) * rr);
			}
		}
		return top;
	}
	ring(cx, y, cz, r, rows = 1) {
		const n = Math.round((2 * Math.PI * r) / SP);
		for (let row = 0; row < rows; row++)
			for (let k = 0; k < n; k++) {
				const a = ((k + row * 0.5) / n) * Math.PI * 2;
				this.cube(cx + Math.cos(a) * r, y + row * SP, cz + Math.sin(a) * r, CUBE * 0.8);
			}
	}
	platform(cx, cz, w, d, t = 0.5) {
		const step = t + 0.06;
		const nx = Math.round(w / step), nz = Math.round(d / step);
		for (let i = 0; i < nx; i++)
			for (let j = 0; j < nz; j++)
				this.tile(cx + (i - (nx - 1) / 2) * step, -0.2, cz + (j - (nz - 1) / 2) * step, t);
	}
	block(cx, cz, nx, ny, nz) {
		for (let i = 0; i < nx; i++)
			for (let j = 0; j < ny; j++)
				for (let k = 0; k < nz; k++)
					this.cube(cx + (i - (nx - 1) / 2) * SP, j * SP, cz + (k - (nz - 1) / 2) * SP);
		return (ny - 1) * SP;
	}
	label(text, x, y, z) { this.labels.push({ text, p: new THREE.Vector3(x, y, z) }); }
	link(a, b, h = 0.6, dashed = false) {
		const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
		const mid = va.clone().lerp(vb, 0.5); mid.y += h;
		this.links.push({ curve: new THREE.QuadraticBezierCurve3(va, mid, vb), dashed });
	}
}

// Fixed field of faint specks; formations that need fewer blocks park the rest here.
const dust = [];
for (let i = 0; i < N; i++) {
	const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1), r = lerp(14, 30, rand());
	dust.push({ x: Math.sin(ph) * Math.cos(th) * r, y: Math.cos(ph) * r * 0.6 + 2, z: Math.sin(ph) * Math.sin(th) * r - 4, sx: 0.06, sy: 0.06, sz: 0.06, kind: 'dust' });
}

function scattered() {
	const f = new Formation();
	for (let i = 0; i < N; i++) {
		const th = rand() * Math.PI * 2, R = lerp(22, 34, rand());
		f.items.push({ x: Math.cos(th) * R * 1.4, y: Math.sin(th) * R * 0.8 + 2, z: lerp(-14, 6, rand()), sx: CUBE, sy: CUBE, sz: CUBE, kind: 'solid' });
	}
	return f;
}

function database() {
	const f = new Formation();
	f.platform(0, 0, 7.2, 7.2);
	const top = f.cylinder(0, 0, 2.1);
	f.ring(0, 1.2, 0, 3.3, 2);
	f.label('podatkovna baza', 0, top + 0.9, 0);
	return f;
}

function highAvailability() {
	const f = new Formation();
	f.platform(0, 0, 12, 6);
	const top = f.cylinder(-3, 0, 1.5);
	f.cylinder(3, 0, 1.5);
	f.ring(0, 4.8, 0, 0.7, 1);
	f.label('primary', -3, top + 0.8, 0);
	f.label('secondary · sync', 3, top + 0.8, 0);
	f.label('listener', 0, 5.6, 0);
	f.link([-1.4, 1.6, 0], [1.4, 1.6, 0], 0.7);
	f.link([-0.5, 4.8, 0], [-3, top + 0.2, 0], 0.3);
	f.link([0.5, 4.8, 0], [3, top + 0.2, 0], 0.3, true);
	return f;
}

function hadr() {
	const f = new Formation();
	f.platform(-5.5, 0, 7, 6);
	f.platform(6, 0, 6, 6);
	f.platform(0, -4.6, 1.7, 1.7);
	const top = f.cylinder(-7.2, -0.8, 1.15);
	f.cylinder(-3.8, 0.9, 1.15);
	f.cylinder(5.2, -0.4, 1.15);
	const btop = f.block(7.7, 1.6, 3, 3, 3);
	const wtop = f.block(0, -4.6, 2, 2, 2);
	f.label('primary', -7.2, top + 0.8, -0.8);
	f.label('sync replica', -3.8, top + 0.8, 0.9);
	f.label('dr · async', 5.2, top + 0.8, -0.4);
	f.label('backup', 7.7, btop + 0.7, 1.6);
	f.label('witness', 0, wtop + 0.7, -4.6);
	f.label('lokacija a', -5.5, -0.2, 3.6);
	f.label('lokacija b', 6, -0.2, 3.6);
	f.link([-6.1, 1.4, -0.5], [-4.9, 1.4, 0.7], 0.5);
	f.link([-7.2, top + 0.2, -0.8], [5.2, top + 0.2, -0.4], 4.2, true);
	f.link([0, wtop, -4.6], [-7.2, 0.6, -0.8], 0.8, true);
	f.link([0, wtop, -4.6], [5.2, 0.6, -0.4], 0.8, true);
	f.link([5.2, 0.6, -0.4], [7.7, 0.4, 1.6], 0.6);
	return f;
}

// Bake each formation into flat arrays of exactly N blocks.
function bake(f) {
	const items = f.items.slice().sort((a, b) => (a.x + a.z * 0.15 + a.y * 0.05) - (b.x + b.z * 0.15 + b.y * 0.05));
	const pos = new Float32Array(N * 3), scl = new Float32Array(N * 3), col = new Float32Array(N * 3);
	const step = items.length > N ? items.length / N : 1;
	const c = new THREE.Color();
	for (let i = 0; i < N; i++) {
		const it = i < Math.min(items.length, N) ? items[Math.floor(i * step)] : dust[i];
		pos.set([it.x, it.y, it.z], i * 3);
		scl.set([it.sx, it.sy, it.sz], i * 3);
		if (it.kind === 'tile') c.copy(COL.tile).offsetHSL(0, 0, (rand() - 0.5) * 0.04);
		else if (it.kind === 'dust') c.copy(COL.dust);
		else {
			const t = clamp01((it.y + 0.2) / 4);
			c.copy(COL.deep).lerp(COL.mid, smooth(clamp01(t * 1.6))).lerp(COL.high, clamp01(t * 1.4 - 0.4));
			c.offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.08);
			if (rand() < 0.04) c.copy(COL.lit);
		}
		col.set([c.r, c.g, c.b], i * 3);
	}
	return { pos, scl, col, labels: f.labels, links: f.links };
}

const formations = [scattered(), database(), highAvailability(), hadr()].map(bake);
const STAGES = [
	{ idx: '00', name: 'zbiranje podatkov' },
	{ idx: '01', name: 'podatkovna baza' },
	{ idx: '02', name: 'visoka razpoložljivost' },
	{ idx: '03', name: 'razpoložljivost in obnova' },
];

// Per-block motion personality
const delay = new Float32Array(N), arc = new Float32Array(N), spin = new Float32Array(N);
for (let i = 0; i < N; i++) { delay[i] = rand(); arc[i] = lerp(0.6, 2.6, rand()); spin[i] = (rand() - 0.5) * 6; }

// ---------- scene ----------
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x050b18);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050b18, 0.028);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);

scene.add(new THREE.HemisphereLight(0x9cc4ff, 0x081230, 0.9));
const key = new THREE.DirectionalLight(0xdce9ff, 2.4);
key.position.set(-7, 14, 9);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 50 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0x3b82f6, 1.8);
rim.position.set(9, 5, -12);
scene.add(rim);

const grid = new THREE.GridHelper(120, 120, 0x2a4f9a, 0x15295a);
grid.position.y = -0.26;
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

const blocks = new THREE.InstancedMesh(
	new THREE.BoxGeometry(1, 1, 1),
	new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.25 }),
	N
);
blocks.castShadow = blocks.receiveShadow = true;
blocks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
blocks.frustumCulled = false;
scene.add(blocks);

// Replication links + packets travelling along them, one set per formation that has links.
const linkSets = formations.map((f) => {
	if (!f.links.length) return null;
	const group = new THREE.Group();
	const mats = [];
	for (const l of f.links) {
		const geo = new THREE.BufferGeometry().setFromPoints(l.curve.getPoints(40));
		const mat = l.dashed
			? new THREE.LineDashedMaterial({ color: 0x8cc8fb, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0, depthWrite: false })
			: new THREE.LineBasicMaterial({ color: 0x8cc8fb, transparent: true, opacity: 0, depthWrite: false });
		const line = new THREE.Line(geo, mat);
		if (l.dashed) line.computeLineDistances();
		group.add(line);
		mats.push(mat);
	}
	const P = 14 * f.links.length;
	const packets = new THREE.InstancedMesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshBasicMaterial({ color: 0xcfeaff, toneMapped: false }),
		P
	);
	packets.frustumCulled = false;
	group.add(packets);
	scene.add(group);
	return { links: f.links, mats, packets, P };
});

// HTML labels anchored to 3D points
const labelSets = formations.map((f) =>
	f.labels.map((l) => {
		const el = document.createElement('span');
		el.className = 'tag';
		el.textContent = l.text;
		labelLayer.appendChild(el);
		return { el, p: l.p };
	})
);

const CAMS = [
	{ pos: [0, 3, 30], at: [0, 1.5, 0] },
	{ pos: [0, 4.8, 13.5], at: [0, 1.5, 0] },
	{ pos: [0, 7, 17.5], at: [0, 1.4, 0] },
	{ pos: [0, 11, 24], at: [0.3, 0.8, 0] },
];

// ---------- sizing & input ----------
let W = 0, H = 0, distScale = 1;
function resize() {
	W = innerWidth; H = innerHeight;
	renderer.setSize(W, H, false);
	camera.aspect = W / H;
	distScale = Math.max(1, 0.95 / camera.aspect);
	scene.fog.density = 0.028 / distScale;
	if (W >= 960) camera.setViewOffset(W, H, -W * 0.17, 0, W, H); // structure to the right of the text
	else camera.clearViewOffset();                                 // phones: offset is set per frame
	camera.updateProjectionMatrix();
	measure();
}

let anchors = [0, 1, 2];
function measure() {
	const vh = innerHeight;
	const a = document.getElementById('izzivi'), b = document.getElementById('storitve');
	anchors = [0, Math.max(1, a.offsetTop - vh * 0.55), Math.max(2, b.offsetTop - vh * 0.55)];
}
function scrollStage() {
	const y = scrollY;
	if (y <= anchors[1]) return clamp01(y / anchors[1]);
	return 1 + clamp01((y - anchors[1]) / (anchors[2] - anchors[1]));
}

const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
addEventListener('pointermove', (e) => { mouse.tx = e.clientX / W - 0.5; mouse.ty = e.clientY / H - 0.5; }, { passive: true });
addEventListener('resize', resize);
addEventListener('load', measure);
resize();

// ---------- frame ----------
const dummy = new THREE.Object3D();
const color = new THREE.Color();
const litColor = COL.lit;
const v = new THREE.Vector3();
const camPos = new THREE.Vector3(), camAt = new THREE.Vector3();
const INTRO = 3.4;
let start = performance.now(), last = start, s = reduceMotion ? 1 : 0, shownStage = -1;

function frame(now) {
	const time = (now - start) / 1000;
	const dt = Math.min(0.05, (now - last) / 1000);
	last = now;

	const intro = reduceMotion ? 1 : clamp01(time / INTRO);
	const target = intro < 1 ? intro : 1 + scrollStage();
	s = intro < 1 ? target : s + (target - s) * (1 - Math.exp(-dt * 5));

	const seg = Math.min(2, Math.floor(s));
	const t = s - seg;
	const A = formations[seg], B = formations[seg + 1];
	const span = seg === 0 ? 0.5 : 0.6;
	const ic = blocks.instanceColor.array;

	for (let i = 0; i < N; i++) {
		const e = ease(clamp01((t - delay[i] * (1 - span)) / span));
		const i3 = i * 3;
		const lift = Math.sin(Math.PI * e);
		let x = lerp(A.pos[i3], B.pos[i3], e);
		let y = lerp(A.pos[i3 + 1], B.pos[i3 + 1], e) + lift * arc[i] * (seg === 0 ? 0.6 : 1);
		let z = lerp(A.pos[i3 + 2], B.pos[i3 + 2], e);
		if (seg > 0) { // burst outwards mid-flight, then regroup
			const r = Math.hypot(x, z) || 1;
			x += (x / r) * lift * arc[i] * 0.8;
			z += (z / r) * lift * arc[i] * 0.8;
		}
		const sx = lerp(A.scl[i3], B.scl[i3], e), sy = lerp(A.scl[i3 + 1], B.scl[i3 + 1], e), sz = lerp(A.scl[i3 + 2], B.scl[i3 + 2], e);
		if (sx < 0.1) y += Math.sin(time * 0.4 + i) * 0.25; // drifting specks

		const rot = lift * spin[i];
		dummy.position.set(x, y, z);
		dummy.rotation.set(rot, rot * 0.6, 0);
		dummy.scale.set(sx, sy, sz);
		dummy.updateMatrix();
		blocks.setMatrixAt(i, dummy.matrix);

		color.setRGB(lerp(A.col[i3], B.col[i3], e), lerp(A.col[i3 + 1], B.col[i3 + 1], e), lerp(A.col[i3 + 2], B.col[i3 + 2], e));
		if (sy > 0.1) { // a slow wave of light travelling up through the data
			const w = Math.pow(Math.max(0, Math.sin(y * 1.5 - time * 2 + x * 0.25)), 14) * 0.45;
			if (w > 0.002) color.lerp(litColor, w);
		}
		ic[i3] = color.r; ic[i3 + 1] = color.g; ic[i3 + 2] = color.b;
	}
	blocks.instanceMatrix.needsUpdate = true;
	blocks.instanceColor.needsUpdate = true;

	// links & packets
	linkSets.forEach((set, k) => {
		if (!set) return;
		const w = smooth(clamp01(1 - Math.abs(s - k) * 2.4));
		set.mats.forEach((m) => { m.opacity = w * 0.75; });
		set.packets.visible = w > 0.01;
		if (!set.packets.visible) return;
		for (let j = 0; j < set.P; j++) {
			const l = set.links[j % set.links.length];
			const f = (time * (l.dashed ? 0.22 : 0.4) + j / set.P * 3.7) % 1;
			l.curve.getPoint(f, v);
			dummy.position.copy(v);
			dummy.rotation.set(0, 0, 0);
			dummy.scale.setScalar(0.09 * w);
			dummy.updateMatrix();
			set.packets.setMatrixAt(j, dummy.matrix);
		}
		set.packets.instanceMatrix.needsUpdate = true;
	});

	// camera
	const cs = Math.min(2, Math.floor(s)), ct = smooth(s - cs);
	const c0 = CAMS[cs], c1 = CAMS[cs + 1];
	camAt.set(lerp(c0.at[0], c1.at[0], ct), lerp(c0.at[1], c1.at[1], ct), lerp(c0.at[2], c1.at[2], ct));
	camPos.set(lerp(c0.pos[0], c1.pos[0], ct), lerp(c0.pos[1], c1.pos[1], ct), lerp(c0.pos[2], c1.pos[2], ct));
	mouse.x += (mouse.tx - mouse.x) * 0.05;
	mouse.y += (mouse.ty - mouse.y) * 0.05;
	const orbit = (reduceMotion ? 0 : Math.sin(time * 0.08) * 0.35) + mouse.x * 0.35;
	camPos.sub(camAt).multiplyScalar(distScale).applyAxisAngle(THREE.Object3D.DEFAULT_UP, orbit);
	camPos.y += mouse.y * 1.5;
	camera.position.copy(camAt).add(camPos);
	camera.lookAt(camAt);
	if (W < 960) { // phones: keep the database below the headline, then centre it once the panels start
		camera.setViewOffset(W, H, 0, -H * 0.2 * (1 - clamp01(s - 1)), W, H);
	}

	renderer.render(scene, camera);

	// labels (projected after render so they match the frame)
	labelSets.forEach((set, k) => {
		const w = clamp01(1 - Math.abs(s - k) * 3.2);
		for (const l of set) {
			if (w <= 0.01) { l.el.style.opacity = 0; continue; }
			v.copy(l.p).project(camera);
			const hidden = v.z > 1;
			l.el.style.opacity = hidden ? 0 : w;
			l.el.style.transform = `translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H}px) translate(-50%, -100%)`;
		}
	});

	const stage = Math.round(s);
	if (stage !== shownStage) {
		shownStage = stage;
		hudIdx.textContent = STAGES[stage].idx;
		hudName.textContent = STAGES[stage].name;
	}
	hudBar.style.transform = `scaleX(${s / 3})`;

	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
