// Tattoo Studio – hlavní aplikace (scéna, UI, tetování, historie, export, tisk)
const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'tattoo-studio-design';
const THEME_KEY = 'tattoo-studio-theme';
const isTouch = matchMedia('(pointer: coarse)').matches;
const tapWord = isTouch ? 'Tap' : 'Click';
const cmToUnits = (cm) => cm / 10 * Body.MH_SCALE; // 1 cm na skutečném těle -> jednotky scény
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ======================= Scéna =======================
const container = $('3d-container');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
camera.position.set(0, 0, 4.3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(container);

// Studiové světlo: obloha/zem, hlavní světlo se stínem, slabé světlo od kamery
scene.add(new THREE.HemisphereLight(0xffffff, 0x8d7f73, 0.55));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
keyLight.position.set(1.5, 3, 2.5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
Object.assign(keyLight.shadow.camera, { left: -1.4, right: 1.4, top: 1.6, bottom: -1.6, near: 0.5, far: 8 });
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.25);
fillLight.position.set(0, 0, 1);
camera.add(fillLight);
scene.add(camera);

// "Podlaha" jen pro stín
const ground = new THREE.Mesh(new THREE.CircleGeometry(1.3, 64), new THREE.ShadowMaterial({ opacity: 0.18 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.3;
controls.maxDistance = 12;
controls.autoRotateSpeed = 2;

// Plynulý přelet kamery na předvolený pohled
let flight = null;
controls.addEventListener('start', () => { flight = null; });

function flyTo(name, instant = false) {
    if (!body) return;
    const view = Body.views(body, positions)[name];
    const target = new THREE.Vector3(...view.target);
    const dir = new THREE.Vector3(...view.dir).normalize();
    // Na úzkém (telefon na výšku) displeji odstoupit dál, aby se tělo vešlo do šířky
    const dist = view.dist * Math.max(1, 0.7 / camera.aspect);
    const pos = target.clone().addScaledVector(dir, dist);
    if (instant) {
        camera.position.copy(pos);
        controls.target.copy(target);
        controls.update();
        camera.updateMatrixWorld(); // raycast/projekce hned, ne až po dalším snímku
        return;
    }
    flight = {
        fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
        toPos: pos, toTarget: target, start: performance.now(),
    };
}

function animate(now) {
    requestAnimationFrame(animate);
    if (flight) {
        const t = Math.min(1, (now - flight.start) / 650);
        const e = 1 - (1 - t) ** 3;
        camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
        controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
        if (t === 1) flight = null;
    }
    controls.update();
    renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// ======================= Tělo =======================
let body = null, positions = null, geometry = null, bodyMesh = null;
const params = { ...Body.DEFAULTS };
let skinColor = '#ffcd94';
let underwear = true;
let units = 'metric';

const skinMaterial = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.62, metalness: 0 });

// Spodní prádlo kreslí shader po pixelech podle pásů z Body.clothBands (ostré, rovné okraje)
const clothUniforms = {
    uBrief: { value: new THREE.Vector4() },
    uTop: { value: new THREE.Vector4() },
    uCloth: { value: new THREE.Color('#2b2b33') },
};
skinMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, clothUniforms);
    shader.vertexShader = `varying vec3 vBodyPos;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyPos = position;');
    shader.fragmentShader = `varying vec3 vBodyPos;\nuniform vec4 uBrief;\nuniform vec4 uTop;\nuniform vec3 uCloth;\n${shader.fragmentShader}`
        .replace('#include <color_fragment>', `#include <color_fragment>
            float ax = abs(vBodyPos.x);
            bool brief = uBrief.w > 0.5 && vBodyPos.y > uBrief.x && vBodyPos.y < uBrief.y && ax < uBrief.z;
            bool top = uTop.w > 0.5 && vBodyPos.y > uTop.x && vBodyPos.y < uTop.y && ax < uTop.z;
            if (brief || top) diffuseColor.rgb = uCloth;`);
};
const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, vertexColors: THREE.VertexColors });

async function loadBody() {
    const [meta, buffer] = await Promise.all([
        fetch('models/makehuman.json').then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); }),
        fetch('models/makehuman.bin').then((r) => { if (!r.ok) throw new Error(r.statusText); return r.arrayBuffer(); }),
    ]);
    body = Body.create(meta, buffer);
    positions = new Float32Array(body.n3);
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(body.n3), 3));
    geometry.setIndex(new THREE.BufferAttribute(body.indices, 1));
    geometry.addGroup(0, meta.bodyIndexCount, 0);                              // kůže
    geometry.addGroup(meta.bodyIndexCount, meta.indexCount - meta.bodyIndexCount, 1); // oči
    bodyMesh = new THREE.Mesh(geometry, [skinMaterial, eyeMaterial]);
    bodyMesh.castShadow = true;
    scene.add(bodyMesh);
    updateBody();
}

function updateBody() {
    Body.computePositions(body, params, positions);
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere(); // Raycaster podle ní filtruje zásahy
    Body.computeColors(body, positions, geometry.attributes.color.array);
    geometry.attributes.color.needsUpdate = true;
    const bands = Body.clothBands(body, positions, params);
    clothUniforms.uBrief.value.set(...bands.brief, underwear ? 1 : 0);
    if (bands.top) clothUniforms.uTop.value.set(...bands.top, underwear ? 1 : 0);
    else clothUniforms.uTop.value.set(0, 0, 0, 0);
    ground.position.y = geometry.boundingBox.min.y + 0.002;
    hidePreview();
    rebuildTattoos();
    updateMeasurements();
    renderPlacedList();
}

let bodyUpdateQueued = false;
function scheduleBodyUpdate() {
    if (bodyUpdateQueued || !body) return;
    bodyUpdateQueued = true;
    requestAnimationFrame(() => { bodyUpdateQueued = false; updateBody(); });
}

// ---- Slidery s mírami (jako Body Visualizer: číslo + jednotka + slider) ----
const UNITS = {
    length: { metric: ['cm', 1, 0], imperial: ['in', 1 / 2.54, 1] }, // [jednotka, násobek, desetinná místa]
    mass: { metric: ['kg', 1, 0], imperial: ['lb', 2.20462, 0] },
};
const unitOf = (kind) => UNITS[kind][units];
const toDisplay = (kind, metric) => +(metric * unitOf(kind)[1]).toFixed(unitOf(kind)[2]);
const fromDisplay = (kind, value) => value / unitOf(kind)[1];
const formatLength = (cm) => `${toDisplay('length', cm)} ${unitOf('length')[0]}`;

const SLIDERS = [
    { param: 'gender', label: 'Sex', ends: ['Female', 'Male'] },
    { param: 'age', label: 'Age', unit: 'years',
        get: () => Math.round(Body.AGE_YEARS[0] + (Body.AGE_YEARS[1] - Body.AGE_YEARS[0]) * params.age),
        set: (v) => clamp((v - Body.AGE_YEARS[0]) / (Body.AGE_YEARS[1] - Body.AGE_YEARS[0]), 0, 1) },
    { param: 'height', label: 'Height', measure: 'height', kind: 'length' },
    { param: 'weight', label: 'Weight', measure: 'weight', kind: 'mass' },
    { param: 'muscle', label: 'Muscle', unit: '%', get: () => Math.round(params.muscle * 100), set: (v) => clamp(v / 100, 0, 1) },
    { param: 'bust', label: 'Chest', measure: 'chest', kind: 'length' },
    { param: 'waist', label: 'Waist', measure: 'waist', kind: 'length' },
    { param: 'hips', label: 'Hips', measure: 'hips', kind: 'length' },
    { param: 'legs', label: 'Inseam', measure: 'inseam', kind: 'length' },
];

function buildBodySliders() {
    const root = $('body-sliders');
    for (const s of SLIDERS) {
        const row = document.createElement('div');
        row.className = 'measure-row';
        const [lo, hi] = Body.range(s.param);
        const id = `m-${s.param}`;
        row.innerHTML = `
            <label for="${id}">${s.label}</label>
            ${s.ends ? '' : `<span class="measure-value"><input id="${id}" type="number" inputmode="decimal" step="any"><span class="unit"></span></span>`}
            <input type="range" min="${lo}" max="${hi}" step="0.005" aria-label="${s.label}" ${s.ends ? `id="${id}"` : ''}>
            ${s.ends ? `<span class="range-ends"><span>${s.ends[0]}</span><span>${s.ends[1]}</span></span>` : ''}`;
        root.appendChild(row);
        s.range = row.querySelector('input[type=range]');
        s.number = s.ends ? null : row.querySelector('input[type=number]');
        s.unitEl = row.querySelector('.unit');
        s.range.value = params[s.param];

        s.range.addEventListener('input', () => {
            params[s.param] = parseFloat(s.range.value);
            scheduleBodyUpdate();
        });
        s.range.addEventListener('change', commit);
        if (s.number) {
            s.number.addEventListener('change', () => {
                const v = parseFloat(s.number.value);
                if (!Number.isFinite(v) || !body) { updateMeasurements(); return; }
                params[s.param] = s.measure
                    ? Body.fit(body, params, s.measure, fromDisplay(s.kind, v))
                    : s.set(v);
                s.range.value = params[s.param];
                updateBody();
                commit();
                s.number.blur();
            });
            s.number.addEventListener('keydown', (e) => { if (e.key === 'Enter') s.number.dispatchEvent(new Event('change')); });
        }
    }
}

function updateMeasurements() {
    if (!body) return;
    const m = Body.measure(body, positions);
    for (const s of SLIDERS) {
        s.range.value = params[s.param];
        if (!s.number) continue;
        s.unitEl.textContent = s.kind ? unitOf(s.kind)[0] : s.unit;
        if (document.activeElement === s.number) continue; // nepřepisovat, co uživatel píše
        s.number.value = s.measure ? toDisplay(s.kind, m[s.measure]) : s.get();
    }
}

$('units-toggle').addEventListener('click', () => {
    units = units === 'metric' ? 'imperial' : 'metric';
    $('units-toggle').textContent = units === 'metric' ? 'Switch to inches / lb' : 'Switch to cm / kg';
    updateMeasurements();
    updateSettingsPanel();
    renderPlacedList();
    saveLocal();
});

$('reset-body').addEventListener('click', () => {
    Object.assign(params, { ...Body.DEFAULTS, gender: params.gender });
    updateBody();
    commit();
});

// ---- Kůže ----
const skinButtons = document.querySelectorAll('.skin-color');
function setSkin(color) {
    skinColor = color;
    skinMaterial.color.set(color);
    skinButtons.forEach((b) => b.classList.toggle('selected', b.dataset.color === color));
    $('skin-custom').value = color;
}
skinButtons.forEach((b) => b.addEventListener('click', () => { setSkin(b.dataset.color); saveLocal(); }));
$('skin-custom').addEventListener('input', (e) => setSkin(e.target.value));
$('skin-custom').addEventListener('change', saveLocal);
$('underwear').addEventListener('change', (e) => {
    underwear = e.target.checked;
    if (body) updateBody();
    saveLocal();
});

// ======================= Knihovna tetování =======================
const library = []; // { path, name, custom }

function libraryItem(path) { return library.find((i) => i.path === path); }

function addToLibrary(path, name, custom = false) {
    if (libraryItem(path)) return;
    library.push({ path, name, custom });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tattoo-button';
    button.dataset.path = path;
    button.title = button.ariaLabel = name;
    button.style.backgroundImage = `url("${path}")`;
    button.addEventListener('click', () => selectLibrary(selectedPath === path ? null : path));
    const list = $('tattoo-list');
    // vlastní návrhy hned za tlačítky Upload/Draw, vestavěné na konec
    if (custom) list.insertBefore(button, list.querySelector('.tattoo-button'));
    else list.appendChild(button);
    filterLibrary();
}

function filterLibrary() {
    const q = $('library-search').value.trim().toLowerCase();
    document.querySelectorAll('.tattoo-button').forEach((b) => { b.hidden = !!q && !b.title.toLowerCase().includes(q); });
}
$('library-search').addEventListener('input', filterLibrary);

async function loadBuiltInTattoos() {
    try {
        const files = await fetch('api/tattoos').then((r) => r.json());
        files.forEach((f) => addToLibrary(`tattoos/${encodeURIComponent(f)}`, f.replace(/\.[^.]+$/, '')));
    } catch (e) {
        console.error('Chyba při načítání tetování:', e);
        toast('Could not load the tattoo library');
    }
}

// Nahraný obrázek zmenšit (max 1024 px) a uložit jako PNG data URL -> přežije obnovení stránky
function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const s = Math.min(1, 1024 / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * s);
            c.height = Math.round(img.height * s);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            resolve(c.toDataURL('image/png'));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
        img.src = url;
    });
}

async function addFiles(files) {
    let last = null;
    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > 20 * 1024 * 1024) { toast(`${file.name} is too large (max 20 MB)`); continue; }
        try {
            last = await fileToDataURL(file);
            addToLibrary(last, file.name.replace(/\.[^.]+$/, '').slice(0, 40), true);
        } catch {
            toast(`Could not read ${file.name}`);
        }
    }
    if (last) {
        showTab('tattoos');
        selectLibrary(last);
        saveLocal();
        toast('Added to your library');
    }
}

$('upload-input').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });

let dragDepth = 0;
const isFileDrag = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', (e) => { if (isFileDrag(e)) { dragDepth++; $('drop-overlay').hidden = false; } });
window.addEventListener('dragleave', (e) => { if (isFileDrag(e) && --dragDepth <= 0) $('drop-overlay').hidden = true; });
window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('drop-overlay').hidden = true;
    addFiles([...e.dataTransfer.files]);
});

// Editor návrhů – nový návrh nebo úprava vybraného
function openEditor(src = null, name = '') {
    Editor.open({
        src,
        name: src ? `${name} (edit)`.slice(0, 40) : '',
        save: (dataURL, newName) => {
            addToLibrary(dataURL, newName, true);
            if (editing) {
                editing.path = dataURL;
                editing.name = newName;
                rebuildTattoo(editing);
                renderPlacedList();
                commit();
            } else {
                selectLibrary(dataURL);
            }
            saveLocal();
            toast('Design saved to your library');
        },
    });
}
$('open-editor').addEventListener('click', () => openEditor());
$('edit-design').addEventListener('click', () => {
    const path = editing ? editing.path : selectedPath;
    if (path) openEditor(path, (editing ? editing.name : libraryItem(path).name));
});

// ======================= Tetování na těle =======================
let tattoos = [];          // { id, path, name, size (cm), rotation (°), flip, anchor: { faceIndex, bary }, mesh }
let selectedPath = null;   // režim "umisťování" – vybrané tetování z knihovny
let editing = null;        // režim "úprav" – vybrané umístěné tetování
const draft = { size: 10, rotation: 0, flip: false, style: 'bw', age: 'fresh' }; // nastavení pro nová tetování
let tattoosVisible = true;
let nextId = 1;
const HIGHLIGHT = new THREE.Color('#ffc2d8');

// Každé tetování má vlastní styl inkoustu a stáří
const textureOf = (t, preview = false) => Ink.texture(t.path, { flip: t.flip, preview, style: t.style, age: t.age });
function aspectOf(t) { return textureOf(t).aspect || 1; }
function inkAreaCm2(t) {
    const [w, h] = dimensionsCm(t);
    return w * h * (textureOf(t).coverage || 0);
}
const formatArea = (cm2) => (units === 'metric' ? `${Math.round(cm2)} cm²` : `${(cm2 / 6.4516).toFixed(1)} in²`);
function dimensionsCm(t) {
    const a = aspectOf(t);
    return a >= 1 ? [t.size, t.size / a] : [t.size * a, t.size];
}

// Okrajové trojúhelníky přesahují obrázek – mimo UV 0..1 nic nekreslit
const clipToArt = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
        'if (any(lessThan(vUv, vec2(0.0))) || any(greaterThan(vUv, vec2(1.0)))) discard;\n#include <map_fragment>');
};

// Obrázek "nalepený" na kůži kolem kotvy – obtočí se kolem paže, nohy, boku…
function createTattooMesh(t, preview = false) {
    const tex = textureOf(t, preview);
    const [wCm, hCm] = dimensionsCm(t);
    const patch = Body.wrapPatch(body, positions, t.anchor, cmToUnits(wCm), cmToUnits(hCm), t.rotation * Math.PI / 180);
    if (!patch.positions.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(patch.positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(patch.uvs, 2));
    geo.computeBoundingSphere();

    // Inkoust se násobí do kůže: bílá zmizí, tuš ztmaví kůži včetně jejího stínování
    const material = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        blending: THREE.MultiplyBlending,
        premultipliedAlpha: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
    });
    material.onBeforeCompile = clipToArt;
    const mesh = new THREE.Mesh(geo, material);
    mesh.renderOrder = 1;
    mesh.userData.tattoo = t;
    return mesh;
}

function disposeMesh(mesh) {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
}

function rebuildTattoo(t) {
    disposeMesh(t.mesh);
    t.mesh = createTattooMesh(t);
    if (!t.mesh) return;
    t.mesh.visible = tattoosVisible && !t.hidden;
    if (t === editing) t.mesh.material.color.copy(HIGHLIGHT);
    scene.add(t.mesh);
}

function rebuildTattoos() { if (body) tattoos.forEach(rebuildTattoo); }

// Při tažení přestavět nejvýš jednou za snímek
let rebuildQueued = null;
function queueRebuild(t) {
    if (rebuildQueued) { rebuildQueued = t; return; }
    rebuildQueued = t;
    requestAnimationFrame(() => { const x = rebuildQueued; rebuildQueued = null; if (tattoos.includes(x)) rebuildTattoo(x); });
}

// Náhled pod kurzorem při umisťování (jen myš; na dotyku se umisťuje rovnou ťuknutím)
let preview = null, previewAnchor = null, previewQueued = false;
function hidePreview() { disposeMesh(preview); preview = null; }
function refreshPreview() {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(() => {
        previewQueued = false;
        hidePreview();
        if (!selectedPath || !previewAnchor || !body) return;
        preview = createTattooMesh({ path: selectedPath, ...draft, anchor: previewAnchor }, true);
        if (preview) scene.add(preview);
    });
}

Ink.onReady = () => {
    rebuildTattoos();
    refreshPreview();
    updateSettingsPanel();
    renderPlacedList();
};

// ---- Výběr a raycasting ----
const raycaster = new THREE.Raycaster();
function pick(event) {
    if (!body) return { anchor: null, tattoo: null };
    const rect = renderer.domElement.getBoundingClientRect();
    const cast = (dx) => {
        raycaster.setFromCamera(new THREE.Vector2(
            ((event.clientX + dx - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        ), camera);
        return raycaster.intersectObject(bodyMesh)[0];
    };
    // Paprsek přesně ve středové rovině těla (x = 0) jde po hranách trojúhelníků a three.js
    // ho nezachytí – zkusit znovu o půl pixelu vedle
    const bodyHit = cast(0) || cast(0.5);
    const meshes = tattoos.map((t) => t.mesh).filter((m) => m && m.visible);
    const tatHit = raycaster.intersectObjects(meshes)[0];
    const tattoo = tatHit && (!bodyHit || tatHit.distance <= bodyHit.distance + 0.02) ? tatHit.object.userData.tattoo : null;
    return { anchor: bodyHit ? anchorFromHit(bodyHit) : null, tattoo };
}

function anchorFromHit(hit) {
    if (hit.faceIndex >= body.bodyTriCount) return null; // oči
    const i = hit.faceIndex * 3;
    const v = (k) => new THREE.Vector3().fromArray(positions, body.indices[i + k] * 3);
    const bary = new THREE.Triangle(v(0), v(1), v(2)).getBarycoord(hit.point, new THREE.Vector3());
    return { faceIndex: hit.faceIndex, bary: bary.toArray() };
}

// Střed tetování v souřadnicích okna (pro tažení s odsazením a posun šipkami)
function screenOf(t) {
    const p = new THREE.Vector3(...Body.anchorPoint(body, positions, t.anchor)).project(camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height };
}

const normalAt = (t, cm) => Body.surfaceNormal(body, positions, t.anchor.faceIndex, Body.anchorPoint(body, positions, t.anchor), cmToUnits(cm));

// Kotva na kůži pod bodem p ve směru normály n (paprsek zvenku dovnitř)
function anchorAt(p, n) {
    raycaster.set(p.clone().addScaledVector(n, 0.15), n.clone().negate());
    const hit = raycaster.intersectObject(bodyMesh)[0];
    return hit ? anchorFromHit(hit) : null;
}

// ---- Režimy: umisťování / úpravy ----
function selectLibrary(path) {
    if (editing) stopEditing();
    selectedPath = path;
    document.querySelectorAll('.tattoo-button').forEach((b) => b.classList.toggle('selected', b.dataset.path === path));
    if (!path) hidePreview();
    else refreshPreview();
    updateSettingsPanel();
    updateHint();
}

function startEditing(t) {
    if (editing === t) return;
    if (editing) stopEditing();
    selectedPath = null;
    document.querySelectorAll('.tattoo-button').forEach((b) => b.classList.remove('selected'));
    hidePreview();
    editing = t;
    if (t.mesh) t.mesh.material.color.copy(HIGHLIGHT);
    showTab('tattoos');
    updateSettingsPanel();
    renderPlacedList();
    updateHint();
}

function stopEditing() {
    if (editing && editing.mesh) editing.mesh.material.color.set(0xffffff);
    editing = null;
    updateSettingsPanel();
    renderPlacedList();
    updateHint();
}

function placeTattoo(anchor) {
    const item = libraryItem(selectedPath);
    const t = { id: nextId++, path: selectedPath, name: item ? item.name : 'Tattoo', ...draft, anchor, mesh: null };
    tattoos.push(t);
    rebuildTattoo(t);
    commit();
    startEditing(t); // hned lze doladit velikost/rotaci
    toast(`Placed on ${regionName(t).toLowerCase()}`);
}

function deleteTattoo(t) {
    disposeMesh(t.mesh);
    tattoos = tattoos.filter((x) => x !== t);
    if (editing === t) editing = null;
    updateSettingsPanel();
    renderPlacedList();
    updateHint();
    commit();
}

// Kopie na druhou stranu těla (tělo je souměrné podle x = 0)
function mirrorTattoo(t) {
    const p = new THREE.Vector3(...Body.anchorPoint(body, positions, t.anchor));
    const n = new THREE.Vector3(...normalAt(t, 2));
    p.x = -p.x;
    n.x = -n.x;
    const anchor = anchorAt(p, n);
    if (!anchor) { toast('Could not find the mirrored spot'); return; }
    addCopy({ ...t, flip: !t.flip, rotation: -t.rotation, anchor, locked: false });
    toast('Mirrored to the other side');
}

function addCopy(t) {
    const copy = { ...t, id: nextId++, mesh: null };
    tattoos.push(copy);
    rebuildTattoo(copy);
    commit();
    startEditing(copy);
}

function duplicateTattoo(t) {
    addCopy({ ...t, name: `${t.name} copy`.slice(0, 40), locked: false });
    toast('Duplicated – drag it into place');
}

// Přesunout na středovou osu těla (hrudní kost, páteř, pupek…)
function centerTattoo(t) {
    if (t.locked) return;
    const p = new THREE.Vector3(...Body.anchorPoint(body, positions, t.anchor));
    const n = new THREE.Vector3(...normalAt(t, 2));
    p.x = 0;
    n.x = 0;
    const anchor = n.lengthSq() > 0.01 && anchorAt(p, n.normalize());
    if (!anchor) { toast('Centering works on the front or back of the body'); return; }
    t.anchor = anchor;
    rebuildTattoo(t);
    renderPlacedList();
    commit();
}

// Kde na těle tetování je – pro seznam a tiskový list pro tatéra
function regionName(t) {
    return Body.region(body, positions, Body.anchorPoint(body, positions, t.anchor), normalAt(t, 2));
}

// ---- Ovládání myší / dotykem ----
const canvas = renderer.domElement;
const pointers = new Map();
let tapStart = null;

let drag = null; // { t, id, dx, dy, x, y, moved } – tažení umístěného tetování po kůži

function endDrag() {
    if (!drag) return;
    const { moved } = drag;
    drag = null;
    controls.enabled = true;
    canvas.style.cursor = '';
    if (moved) { renderPlacedList(); commit(); }
}

canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, e);
    tapStart = pointers.size === 1 ? { x: e.clientX, y: e.clientY, time: performance.now() } : null;
    if (pointers.size > 1) { endDrag(); return; } // druhý prst = otáčení/zoom kamery
    if (selectedPath || e.button !== 0) return;
    const { tattoo } = pick(e);
    if (!tattoo || tattoo.locked) return;
    // OrbitControls poslouchá mousedown/touchstart, které přijdou až po pointerdown -> stihne se vypnout
    controls.enabled = false;
    const s = screenOf(tattoo);
    drag = { t: tattoo, id: e.pointerId, dx: s.x - e.clientX, dy: s.y - e.clientY, x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    startEditing(tattoo);
});
canvas.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.id) {
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
        const { anchor } = pick({ clientX: e.clientX + drag.dx, clientY: e.clientY + drag.dy });
        if (!anchor) return;
        drag.moved = true;
        drag.t.anchor = anchor;
        queueRebuild(drag.t);
        return;
    }
    if (e.pointerType !== 'mouse' || pointers.size) return;
    const { anchor, tattoo } = pick(e);
    canvas.style.cursor = tattoo && !selectedPath ? (tattoo.locked ? 'pointer' : 'grab')
        : (selectedPath && anchor) || (editing && anchor) ? 'pointer' : '';
    if (selectedPath) { previewAnchor = anchor; refreshPreview(); }
});
canvas.addEventListener('pointerleave', () => { previewAnchor = null; hidePreview(); });
const endPointer = (e) => {
    const dragged = drag && drag.moved;
    if (drag && e.pointerId === drag.id) endDrag();
    const wasTap = !dragged && tapStart && pointers.size === 1 && e.type === 'pointerup'
        && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 8
        && performance.now() - tapStart.time < 600;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) tapStart = null;
    if (wasTap) handleTap(e);
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function handleTap(e) {
    const { anchor, tattoo } = pick(e);
    if (selectedPath) {
        if (anchor) placeTattoo(anchor);
    } else if (tattoo) {
        startEditing(tattoo);
    } else if (editing && anchor && !editing.locked) {
        editing.anchor = anchor; // přesun na nové místo
        rebuildTattoo(editing);
        renderPlacedList();
        commit();
    } else if (editing) {
        stopEditing();
    }
}

// ---- Panel nastavení (velikost, rotace, flip…) ----
const sizeInput = $('tattoo-size'), rotationInput = $('tattoo-rotation');
const settingsTarget = () => editing || draft;

function updateSettingsPanel() {
    const t = settingsTarget();
    sizeInput.value = t.size;
    rotationInput.value = t.rotation;
    const path = editing ? editing.path : selectedPath;
    const [w, h] = path ? dimensionsCm({ ...t, path }) : [t.size, t.size];
    $('size-value').textContent = `${formatLength(w).split(' ')[0]} × ${formatLength(h)}`;
    $('rotation-value').textContent = `${t.rotation}°`;
    $('flip-tattoo').setAttribute('aria-pressed', !!t.flip);
    syncInk();
    $('ink-title').textContent = editing ? `Ink – ${editing.name}` : 'Ink – new tattoos';
    $('settings-title').textContent = editing ? `Editing: ${editing.name}` : selectedPath ? `New: ${libraryItem(selectedPath).name}` : 'New tattoo';
    $('done-editing').hidden = !editing;
    for (const id of ['mirror-tattoo', 'delete-tattoo', 'duplicate-tattoo', 'lock-tattoo']) $(id).disabled = !editing;
    $('center-tattoo').disabled = !editing || editing.locked;
    $('lock-tattoo').setAttribute('aria-pressed', !!(editing && editing.locked));
    const nameInput = $('tattoo-name');
    nameInput.hidden = !editing;
    if (editing && document.activeElement !== nameInput) nameInput.value = editing.name;
    $('edit-design').disabled = !(editing || selectedPath);
}

function changeSetting(apply, final) {
    const t = settingsTarget();
    apply(t);
    if (editing) { rebuildTattoo(editing); if (final) { commit(); renderPlacedList(); } }
    else refreshPreview();
    updateSettingsPanel();
}

sizeInput.addEventListener('input', () => changeSetting((t) => { t.size = parseFloat(sizeInput.value); }));
sizeInput.addEventListener('change', () => changeSetting(() => {}, true));
rotationInput.addEventListener('input', () => changeSetting((t) => { t.rotation = parseInt(rotationInput.value, 10); }));
rotationInput.addEventListener('change', () => changeSetting(() => {}, true));
$('flip-tattoo').addEventListener('click', () => changeSetting((t) => { t.flip = !t.flip; }, true));
$('mirror-tattoo').addEventListener('click', () => editing && mirrorTattoo(editing));
$('delete-tattoo').addEventListener('click', () => editing && deleteTattoo(editing));
$('done-editing').addEventListener('click', stopEditing);
$('duplicate-tattoo').addEventListener('click', () => editing && duplicateTattoo(editing));
$('center-tattoo').addEventListener('click', () => editing && centerTattoo(editing));
$('lock-tattoo').addEventListener('click', () => editing && toggleLock(editing));
$('tattoo-name').addEventListener('input', (e) => {
    if (!editing) return;
    editing.name = e.target.value.slice(0, 40) || 'Tattoo';
    $('settings-title').textContent = `Editing: ${editing.name}`;
});
$('tattoo-name').addEventListener('change', () => { renderPlacedList(); commit(); });

function toggleLock(t) {
    t.locked = !t.locked;
    updateSettingsPanel();
    updateHint();
    renderPlacedList();
    commit();
    toast(t.locked ? 'Position locked' : 'Position unlocked');
}

function toggleHidden(t) {
    t.hidden = !t.hidden;
    if (t.mesh) t.mesh.visible = tattoosVisible && !t.hidden;
    renderPlacedList();
    commit();
}

// Posun po kůži o pár pixelů na obrazovce (šipky)
function nudge(t, dx, dy) {
    if (t.locked) return;
    const s = screenOf(t);
    const { anchor } = pick({ clientX: s.x + dx, clientY: s.y + dy });
    if (!anchor) return;
    t.anchor = anchor;
    rebuildTattoo(t);
    renderPlacedList();
    commit();
}

// Shift+kolečko = velikost, Alt+kolečko = rotace (zachytit dřív než zoom OrbitControls)
let wheelCommit = null;
container.addEventListener('wheel', (e) => {
    if (!(editing || selectedPath) || !(e.shiftKey || e.altKey)) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = Math.sign(e.deltaY || e.deltaX); // Shift+kolečko posílá ve Windows deltaX
    if (!dir) return;
    changeSetting(e.altKey
        ? (t) => { t.rotation = wrapDegrees(t.rotation - dir * 5); }
        : (t) => { t.size = clamp(t.size - dir * 0.5, 1, 60); });
    clearTimeout(wheelCommit);
    wheelCommit = setTimeout(() => changeSetting(() => {}, true), 400);
}, { capture: true, passive: false });

const wrapDegrees = (d) => ((Math.round(d) + 540) % 360) - 180;

// ---- Inkoust ----
function setupSegmented(id, get, set) {
    const group = $(id);
    const sync = () => group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', b.dataset.value === get()));
    group.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { set(b.dataset.value); sync(); }));
    sync();
    return sync;
}

function setInk(next) {
    Ink.setSettings({ ...Ink.settings, ...next });
    rebuildTattoos();
    refreshPreview();
    $('bg-value').textContent = Ink.settings.background >= 1 ? 'Off' : `${Math.round((1 - Ink.settings.background) * 200)}%`;
    saveLocal();
}
// Styl a stáří platí pro vybrané tetování (nebo pro nově umisťovaná)
setupSegmented('ink-style', () => settingsTarget().style, (v) => changeSetting((t) => { t.style = v; }, true));
setupSegmented('ink-age', () => settingsTarget().age, (v) => changeSetting((t) => { t.age = v; }, true));
function syncInk() {
    for (const [id, key] of [['ink-style', 'style'], ['ink-age', 'age']]) {
        $(id).querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', b.dataset.value === settingsTarget()[key]));
    }
}
$('ink-background').addEventListener('change', (e) => setInk({ background: parseFloat(e.target.value) }));
$('bg-value').textContent = `${Math.round((1 - Ink.settings.background) * 200)}%`;

// ---- Seznam umístěných ----
function renderPlacedList() {
    const list = $('placed-tattoos');
    list.innerHTML = '';
    for (const t of tattoos) {
        const li = document.createElement('li');
        li.className = `${t === editing ? 'active' : ''} ${t.hidden ? 'is-hidden' : ''}`;
        const main = document.createElement('button');
        main.type = 'button';
        main.className = 'placed-main';
        const img = document.createElement('img');
        img.src = t.path;
        img.alt = '';
        const text = document.createElement('span');
        text.className = 'placed-text';
        const name = document.createElement('strong');
        name.textContent = t.locked ? `🔒 ${t.name}` : t.name;
        const meta = document.createElement('small');
        const [w, h] = dimensionsCm(t);
        meta.textContent = body ? `${regionName(t)} · ${formatLength(w).split(' ')[0]} × ${formatLength(h)}` : '';
        text.append(name, meta);
        main.append(img, text);
        main.addEventListener('click', () => { startEditing(t); flyToTattoo(t); });

        const iconButton = (label, title, onClick) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'icon-button';
            b.textContent = label;
            b.title = b.ariaLabel = title;
            b.addEventListener('click', onClick);
            return b;
        };
        li.append(main,
            iconButton(t.hidden ? '◌' : '👁', `${t.hidden ? 'Show' : 'Hide'} ${t.name}`, () => toggleHidden(t)),
            iconButton('⧉', `Mirror ${t.name} to the other side`, () => mirrorTattoo(t)),
            iconButton('✕', `Remove ${t.name}`, () => deleteTattoo(t)));
        list.appendChild(li);
    }
    // Kolik kůže je pokryto inkoustem (podle skutečně tmavých pixelů obrázku)
    const shown = tattoos.filter((t) => !t.hidden);
    const ink = shown.reduce((s, t) => s + inkAreaCm2(t), 0);
    $('coverage').hidden = !body || !shown.length;
    if (body && shown.length) {
        const skin = Body.surfaceArea(body, positions);
        $('coverage').textContent = `Ink coverage ≈ ${formatArea(ink)} · ${(ink / skin * 100).toFixed(1)} % of skin`;
    }
    $('placed-count').textContent = tattoos.length;
    $('placed-empty').hidden = tattoos.length > 0;
    $('clear-tattoos').hidden = tattoos.length === 0;
}

// Kamera k tetování: kolmo na kůži
function flyToTattoo(t) {
    const p = Body.anchorPoint(body, positions, t.anchor);
    const n = normalAt(t, 3);
    const target = new THREE.Vector3(...p);
    const dist = Math.max(0.5, cmToUnits(t.size) * 4);
    flight = {
        fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
        toPos: target.clone().addScaledVector(new THREE.Vector3(...n), dist), toTarget: target, start: performance.now(),
    };
}

$('clear-tattoos').addEventListener('click', () => {
    if (!confirm(`Remove all ${tattoos.length} tattoos?`)) return;
    tattoos.forEach((t) => disposeMesh(t.mesh));
    tattoos = [];
    editing = null;
    updateSettingsPanel();
    renderPlacedList();
    updateHint();
    commit();
});

// ======================= Historie (undo/redo) a ukládání =======================
const serializeTattoo = (t) => ({
    path: t.path, name: t.name, size: t.size, rotation: t.rotation, flip: !!t.flip,
    locked: !!t.locked, hidden: !!t.hidden, style: t.style, age: t.age,
    anchor: { faceIndex: t.anchor.faceIndex, bary: t.anchor.bary },
});
const snapshot = () => JSON.stringify({ params, tattoos: tattoos.map(serializeTattoo) });
let undoStack = [], redoStack = [], current = null;

function commit() {
    const now = snapshot();
    if (now === current) return;
    if (current !== null) undoStack.push(current);
    if (undoStack.length > 100) undoStack.shift();
    current = now;
    redoStack = [];
    updateHistoryButtons();
    saveLocal();
}

function restore(state) {
    const s = JSON.parse(state);
    Object.assign(params, s.params);
    setTattoos(s.tattoos);
    updateBody();
}

function undo() {
    if (!undoStack.length) return;
    redoStack.push(current);
    current = undoStack.pop();
    restore(current);
    updateHistoryButtons();
    saveLocal();
}

function redo() {
    if (!redoStack.length) return;
    undoStack.push(current);
    current = redoStack.pop();
    restore(current);
    updateHistoryButtons();
    saveLocal();
}

function updateHistoryButtons() {
    $('undo').disabled = !undoStack.length;
    $('redo').disabled = !redoStack.length;
}
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);

function setTattoos(list) {
    tattoos.forEach((t) => disposeMesh(t.mesh));
    editing = null;
    tattoos = list.map((t) => ({ ...t, id: nextId++, mesh: null }));
    rebuildTattoos();
    updateSettingsPanel();
    renderPlacedList();
    updateHint();
}

function designJSON() {
    return {
        app: 'tattoo-studio',
        version: 1,
        params: { ...params },
        skinColor,
        underwear,
        units,
        ink: { ...Ink.settings, style: draft.style, age: draft.age }, // styl/stáří = výchozí pro nová tetování
        library: library.filter((i) => i.custom).map(({ path, name }) => ({ path, name })),
        tattoos: tattoos.map(serializeTattoo),
    };
}

// Načtení návrhu ze souboru/úložiště – data zvenku, proto vše ověřit
function applyDesign(d) {
    if (!d || d.app !== 'tattoo-studio' || typeof d !== 'object') throw new Error('Not a Tattoo Studio project');
    const num = (v, lo, hi, def) => (Number.isFinite(v) ? clamp(v, lo, hi) : def);
    const isImage = (p) => typeof p === 'string' && (p.startsWith('data:image/') || /^\/tattoos\/[^/]+$/.test(p));
    for (const k in Body.DEFAULTS) params[k] = num(d.params && d.params[k], ...Body.range(k), Body.DEFAULTS[k]);
    if (/^#[0-9a-f]{6}$/i.test(d.skinColor)) setSkin(d.skinColor);
    underwear = d.underwear !== false;
    $('underwear').checked = underwear;
    if (d.units === 'imperial' || d.units === 'metric') units = d.units;
    $('units-toggle').textContent = units === 'metric' ? 'Switch to inches / lb' : 'Switch to cm / kg';
    const ink = d.ink || {};
    Ink.setSettings(ink);
    // starší projekty měly jeden styl pro všechna tetování -> použít ho jako výchozí
    const styleOf = (s, def) => (Ink.STYLES.includes(s) ? s : def);
    const ageOf = (a, def) => (Ink.AGES.includes(a) ? a : def);
    draft.style = styleOf(ink.style, 'bw');
    draft.age = ageOf(ink.age, 'fresh');
    $('ink-background').value = Ink.settings.background;
    for (const item of Array.isArray(d.library) ? d.library : []) {
        if (isImage(item.path)) addToLibrary(item.path, String(item.name || 'My design').slice(0, 40), true);
    }
    const list = [];
    for (const t of Array.isArray(d.tattoos) ? d.tattoos : []) {
        const a = t && t.anchor;
        if (!isImage(t.path) || !a || !Number.isInteger(a.faceIndex) || a.faceIndex < 0 || a.faceIndex >= body.bodyTriCount) continue;
        if (!Array.isArray(a.bary) || a.bary.length !== 3 || !a.bary.every(Number.isFinite)) continue;
        list.push({
            path: t.path,
            name: String(t.name || 'Tattoo').slice(0, 40),
            size: num(t.size, 1, 60, 10),
            rotation: wrapDegrees(num(t.rotation, -360, 360, 0)),
            flip: !!t.flip,
            locked: !!t.locked,
            hidden: !!t.hidden,
            style: styleOf(t.style, draft.style),
            age: ageOf(t.age, draft.age),
            anchor: { faceIndex: a.faceIndex, bary: a.bary },
        });
    }
    setTattoos(list);
    updateBody();
}

let saveTimer = null, warnedStorage = false;
function saveLocal() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(designJSON()));
        } catch (e) {
            if (!warnedStorage) toast('Browser storage is full – use "Download project" to keep your work');
            warnedStorage = true;
        }
    }, 300);
}

$('save-design').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(designJSON())], { type: 'application/json' });
    download(URL.createObjectURL(blob), 'tattoo-studio-project.json');
});

$('open-design').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
        applyDesign(JSON.parse(await file.text()));
        commit();
        toast('Project opened');
    } catch (err) {
        toast(`Could not open: ${err.message}`);
    }
});

$('start-over').addEventListener('click', () => {
    if (!confirm('Start over? This removes all placed tattoos and resets the body. Your library stays.')) return;
    Object.assign(params, Body.DEFAULTS);
    setTattoos([]);
    updateBody();
    commit();
    flyTo('front');
});

// ======================= Export a tisk =======================
function download(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Vykreslí aktuální pohled bez náhledu a zvýraznění; vrátí canvas s pozadím
function captureView(bg) {
    const hl = editing && editing.mesh;
    if (hl) hl.material.color.set(0xffffff);
    const pv = preview && preview.visible;
    if (preview) preview.visible = false;
    renderer.render(scene, camera);
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    if (hl) hl.material.color.copy(HIGHLIGHT);
    if (preview) preview.visible = pv;
    return out;
}

const exportBg = () => (document.documentElement.dataset.theme === 'dark' ? '#1c1c22' : '#f1f1f4');

$('export-image').addEventListener('click', () => {
    download(captureView(exportBg()).toDataURL('image/png'), 'tattoo-studio.png');
});

$('export-sheet').addEventListener('click', () => {
    const saved = { pos: camera.position.clone(), target: controls.target.clone(), auto: controls.autoRotate };
    controls.autoRotate = false;
    flight = null;
    const shots = [['front', 'Front'], ['right', 'Side'], ['back', 'Back']].map(([view, label]) => {
        flyTo(view, true);
        return [captureView(exportBg()), label];
    });
    const [w, h] = [shots[0][0].width, shots[0][0].height];
    const sheet = document.createElement('canvas');
    sheet.width = w * 3;
    sheet.height = h;
    const ctx = sheet.getContext('2d');
    shots.forEach(([img, label], i) => {
        ctx.drawImage(img, i * w, 0);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.font = `${Math.round(h / 28)}px system-ui, sans-serif`;
        ctx.fillText(label, i * w + h / 30, h / 18);
    });
    camera.position.copy(saved.pos);
    controls.target.copy(saved.target);
    controls.autoRotate = saved.auto;
    controls.update();
    download(sheet.toDataURL('image/png'), 'tattoo-studio-sheet.png');
});

// Stejný pohled bez tetování a s nimi vedle sebe
$('export-compare').addEventListener('click', () => {
    if (!tattoos.length) { toast('Place a tattoo first'); return; }
    const was = tattoosVisible;
    const setVisible = (v) => tattoos.forEach((t) => { if (t.mesh) t.mesh.visible = v && !t.hidden; });
    setVisible(false);
    const before = captureView(exportBg());
    setVisible(true);
    const after = captureView(exportBg());
    setVisible(was);
    const out = document.createElement('canvas');
    out.width = before.width * 2;
    out.height = before.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(before, 0, 0);
    ctx.drawImage(after, before.width, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.font = `${Math.round(out.height / 28)}px system-ui, sans-serif`;
    ctx.fillText('Before', out.height / 30, out.height / 18);
    ctx.fillText('After', before.width + out.height / 30, out.height / 18);
    download(out.toDataURL('image/png'), 'tattoo-studio-before-after.png');
});

let printStyle = 'original';
setupSegmented('print-style', () => printStyle, (v) => { printStyle = v; });

// Tiskový list pro tatéra: každé tetování ve skutečné velikosti (CSS cm), místo, rozměry, rotace
async function printSheet() {
    const toPrint = tattoos.filter((t) => !t.hidden); // skrytá tetování se netisknou
    if (!toPrint.length) { toast('Place a tattoo first'); return; }
    const mirror = $('print-mirror').checked;
    const sheet = $('print-sheet');
    const PAGE_W = 18; // použitelná šířka A4/Letter v cm
    const items = await Promise.all(toPrint.map(async (t) => {
        const art = await Ink.render(t.path, {
            style: printStyle === 'stencil' ? 'stencil' : t.style,
            age: 'fresh',
            flip: t.flip !== mirror,
            maxSide: 2048,
        });
        const [w, h] = dimensionsCm(t);
        const scale = Math.min(1, PAGE_W / w, 24 / h);
        return { t, src: art.toDataURL('image/png'), w, h, scale };
    }));

    const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const fmt = (cm) => `${cm.toFixed(1)} cm (${(cm / 2.54).toFixed(2)} in)`;
    sheet.innerHTML = `
        <header class="print-header">
            <h1>Tattoo Studio – stencil sheet</h1>
            <p>${new Date().toLocaleDateString()} · ${toPrint.length} tattoo(s) · Print at 100% scale (no "fit to page").
               ${mirror ? 'Images are mirrored for transfer paper.' : ''}</p>
            <div class="ruler"><div class="ruler-bar"></div><span>5 cm – measure to check print scale</span></div>
        </header>
        ${items.map(({ t, src, w, h, scale }, i) => `
            <figure class="print-item">
                <img src="${src}" alt="" style="width:${(w * scale).toFixed(2)}cm;height:${(h * scale).toFixed(2)}cm">
                <figcaption>
                    <strong>${i + 1}. ${esc(t.name)}</strong>
                    <span>Placement: ${esc(regionName(t))}</span>
                    <span>Size: ${fmt(w)} × ${fmt(h)} · ink area ≈ ${Math.round(inkAreaCm2(t))} cm²</span>
                    <span>Rotation on skin: ${t.rotation}° ${t.rotation ? (t.rotation > 0 ? 'clockwise' : 'counter-clockwise') : ''}</span>
                    ${scale < 1 ? `<span class="warn">Larger than the page – printed at ${Math.round(scale * 100)}%. Scale up ${(1 / scale).toFixed(2)}× for real size.</span>` : ''}
                </figcaption>
            </figure>`).join('')}`;
    await Promise.all([...sheet.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
    window.print();
}
$('print').addEventListener('click', printSheet);

// ======================= UI: záložky, pohledy, motiv, nápověda, toast =======================
const TABS = ['body', 'tattoos', 'placed', 'design'];
function showTab(name) {
    for (const t of TABS) {
        $(`tab-${t}`).hidden = t !== name;
        $(`tab-btn-${t}`).setAttribute('aria-selected', t === name);
    }
}
TABS.forEach((t) => $(`tab-btn-${t}`).addEventListener('click', () => showTab(t)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.goto)));

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => flyTo(b.dataset.view)));

$('toggle-tattoos').addEventListener('click', (e) => {
    tattoosVisible = !tattoosVisible;
    tattoos.forEach((t) => { if (t.mesh) t.mesh.visible = tattoosVisible && !t.hidden; });
    e.currentTarget.setAttribute('aria-pressed', !tattoosVisible);
    toast(tattoosVisible ? 'Tattoos shown' : 'Tattoos hidden – before / after');
});

$('auto-rotate').addEventListener('click', (e) => {
    controls.autoRotate = !controls.autoRotate;
    e.currentTarget.setAttribute('aria-pressed', controls.autoRotate);
});

$('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
});

function updateHint() {
    const hint = $('hint');
    if (!body) { hint.textContent = 'Loading…'; return; }
    const keys = isTouch || innerWidth < 700 ? '' : ' · Q/E rotate · +/− size';
    if (selectedPath) hint.textContent = `${tapWord} on the body to place “${libraryItem(selectedPath).name}”${keys} · Esc cancel`;
    else if (editing && editing.locked) hint.textContent = `“${editing.name}” is locked · press L or 🔒 to move it again`;
    else if (editing) hint.textContent = `Editing “${editing.name}” · drag it or ${tapWord.toLowerCase()} the body to move it${keys} · Esc done`;
    else if (tattoos.length) hint.textContent = `${tapWord} a tattoo to edit it, drag to move it, or pick a new one in Tattoos`;
    else hint.textContent = 'Shape the body, then pick a tattoo in the Tattoos tab';
}

let toastTimer = null;
function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---- Klávesnice ----
document.addEventListener('keydown', (e) => {
    if ($('editor').open) return;
    if (e.target.matches('input, select, textarea')) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (key) {
        case 'q': changeSetting((t) => { t.rotation = wrapDegrees(t.rotation - 5); }, true); break;
        case 'e': changeSetting((t) => { t.rotation = wrapDegrees(t.rotation + 5); }, true); break;
        case '+': case '=': changeSetting((t) => { t.size = clamp(t.size + 0.5, 1, 60); }, true); break;
        case '-': changeSetting((t) => { t.size = clamp(t.size - 0.5, 1, 60); }, true); break;
        case 'f': changeSetting((t) => { t.flip = !t.flip; }, true); break;
        case 'm': if (editing) mirrorTattoo(editing); break;
        case 'd': if (editing) duplicateTattoo(editing); break;
        case 'c': if (editing) centerTattoo(editing); break;
        case 'l': if (editing) toggleLock(editing); break;
        case 'arrowleft': case 'arrowright': case 'arrowup': case 'arrowdown': {
            if (!editing) return;
            e.preventDefault();
            const px = e.shiftKey ? 20 : 4;
            nudge(editing, { arrowleft: -px, arrowright: px }[key] || 0, { arrowup: -px, arrowdown: px }[key] || 0);
            break;
        }
        case 'delete': case 'backspace': if (editing) { e.preventDefault(); deleteTattoo(editing); } break;
        case 'escape':
            if (editing) stopEditing();
            else if (selectedPath) selectLibrary(null);
            break;
        default: return;
    }
});

// ======================= Start =======================
buildBodySliders();
setSkin(skinColor);
updateSettingsPanel();
renderPlacedList();
updateHint();

(async () => {
    await loadBuiltInTattoos();
    try {
        await loadBody();
    } catch (e) {
        console.error(e);
        $('loading-text').textContent = 'Could not load the body model. Is the server running?';
        return;
    }
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) applyDesign(JSON.parse(saved));
    } catch (e) {
        console.warn('Saved design ignored:', e);
    }
    current = snapshot();
    $('loading').hidden = true;
    flyTo('front', true);
    updateHint();
})();
