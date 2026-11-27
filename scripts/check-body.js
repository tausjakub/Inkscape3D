// Self-check těla: node scripts/check-body.js   (bez závislostí, čte models/makehuman.*)
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Body = require('../public/body.js');

const root = path.join(__dirname, '..');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'models/makehuman.json')));
const bin = fs.readFileSync(path.join(root, 'models/makehuman.bin'));
const body = Body.create(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const pos = new Float32Array(body.n3);
const shape = (p) => Body.computePositions(body, { ...Body.DEFAULTS, ...p }, pos);
const measure = (p) => Body.measure(body, shape(p));

// 1) Každý target, o který si slidery řeknou, existuje
for (const g of [0, 1]) for (const a of [0, 1]) {
    const p = { ...Body.DEFAULTS, gender: g, age: a, height: 0.1, weight: 2.5, muscle: 1, bust: 1, waist: -1, hips: 1, legs: -1 };
    for (const name in Body.targetWeights(p)) assert(meta.targets.includes(name), `missing target ${name}`);
}

// 2) Míry dávají smysl a slidery jdou správným směrem
const fem = measure({}), male = measure({ gender: 1 });
console.log('female', fem, '\nmale  ', male);
assert(fem.height > 150 && fem.height < 175, 'female height');
assert(male.height > fem.height, 'male taller');
assert(fem.weight > 40 && fem.weight < 80, 'female weight');
assert(measure({ height: 0.9 }).height > measure({ height: 0.1 }).height + 50, 'height slider');
assert(measure({ weight: 2.5 }).weight > measure({ weight: -0.5 }).weight + 30, 'weight slider');
assert(measure({ waist: 1 }).waist > measure({ waist: -1 }).waist, 'waist slider');
assert(measure({ legs: 1 }).inseam > measure({ legs: -1 }).inseam, 'inseam slider');

// 3) Zadání čísla -> slider (bisekce) trefí cílovou míru
for (const [key, target] of [['height', 180], ['waist', 70], ['weight', 65], ['chest', 95], ['inseam', 80]]) {
    const param = Body.FIT_PARAM[key];
    const v = Body.fit(body, Body.DEFAULTS, key, target);
    const got = measure({ [param]: v })[key];
    assert(Math.abs(got - target) < 0.6, `fit ${key}: wanted ${target}, got ${got}`);
}

// 4) Tetování se obtáčí kolem paže (i na zadní stranu), nepřeskočí na trup a kůži moc nedeformuje
shape({});
const cm = (x) => x / 10 * Body.MH_SCALE;
function nearestFace(target) {
    let best = -1, bestD = Infinity;
    for (let t = 0; t < body.bodyTriCount; t++) {
        const v = body.indices[t * 3] * 3;
        const d = Math.hypot(pos[v] - target[0], pos[v + 1] - target[1], pos[v + 2] - target[2]);
        if (d < bestD) { bestD = d; best = t; }
    }
    return best;
}
const triArea = (p, i) => {
    const u = [0, 1, 2].map((k) => p[i + 3 + k] - p[i + k]), v = [0, 1, 2].map((k) => p[i + 6 + k] - p[i + k]);
    return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
};
function checkWrap(label, patch) {
    const P = patch.positions, U = patch.uvs;
    assert(P.length > 0, `${label}: empty`);
    let good = 0, n = 0, inside = 0;
    for (let i = 0; i < P.length; i += 9) {
        const j = (i / 9) * 6;
        for (let k = 0; k < 3; k++) { // 2D délka hrany vs. 3D (relativně k rozměru v UV)
            const a = k, b = (k + 1) % 3;
            const d3 = Math.hypot(P[i + a * 3] - P[i + b * 3], P[i + a * 3 + 1] - P[i + b * 3 + 1], P[i + a * 3 + 2] - P[i + b * 3 + 2]);
            const d2 = Math.hypot((U[j + a * 2] - U[j + b * 2]) * patch.w, (U[j + a * 2 + 1] - U[j + b * 2 + 1]) * patch.h);
            n++;
            if (d2 / d3 > 0.75 && d2 / d3 < 1.33) good++;
        }
        // podíl trojúhelníku uvnitř obrázku (vzorky v barycentrické mřížce)
        let hit = 0, all = 0;
        for (let a = 0; a <= 6; a++) for (let b = 0; a + b <= 6; b++) {
            const w = [a / 6, b / 6, 1 - a / 6 - b / 6];
            const u = w[0] * U[j] + w[1] * U[j + 2] + w[2] * U[j + 4], v = w[0] * U[j + 1] + w[1] * U[j + 3] + w[2] * U[j + 5];
            all++;
            if (u >= 0 && u <= 1 && v >= 0 && v <= 1) hit++;
        }
        inside += triArea(P, i) * hit / all;
    }
    console.log(`${label}: ${P.length / 9} tris, ${(good / n * 100).toFixed(0)}% edges undistorted, covered ${(inside / (patch.w * patch.h) * 100).toFixed(0)}% of art area`);
    assert(good / n > 0.85, `${label}: distortion`);
    assert(inside / (patch.w * patch.h) > 0.7 && inside / (patch.w * patch.h) < 1.1, `${label}: coverage`);
}
const views = Body.views(body, pos);
const arm = views.leftArm.target;
const face = nearestFace([arm[0], arm[1], arm[2] + 0.2]);
const armAnchor = { faceIndex: face, bary: [1, 0, 0] };
const center = Body.anchorPoint(body, pos, armAnchor);
// 22 cm široký pás kolem předloktí (obvod ~25 cm) – musí dosáhnout na zadní stranu paže
const band = { ...Body.wrapPatch(body, pos, armAnchor, cm(22), cm(6), 0), w: cm(22), h: cm(6) };
checkWrap('arm band', band);
let back = 0;
for (let i = 0; i < band.positions.length; i += 3) {
    assert(band.positions[i] > 0.15, 'arm wrap leaks onto torso');
    if (band.positions[i + 2] < center[2] - 0.04) back++;
}
assert(back > 0, 'arm band does not wrap to the back of the arm');
const region = Body.region(body, pos, center, band.normal);
console.log('arm region:', region);
assert(/Left (upper arm|forearm|hand|shoulder)/.test(region), `arm region ${region}`);

// Velký motiv přes bok: z břicha se musí přetočit až na záda; malý na zádech je skoro rovný
const sideFace = nearestFace([0.12, views.chest.target[1] - 0.25, 0.2]);
const ribs = { ...Body.wrapPatch(body, pos, { faceIndex: sideFace, bary: [1, 0, 0] }, cm(40), cm(15), 0), w: cm(40), h: cm(15) };
checkWrap('ribs 40cm', ribs);
assert(ribs.positions.some((x, i) => i % 3 === 2 && x < -0.05), 'ribs piece does not reach the back');
const backFace = nearestFace([0, views.upperBack.target[1], -0.3]);
checkWrap('back 10cm', { ...Body.wrapPatch(body, pos, { faceIndex: backFace, bary: [1, 0, 0] }, cm(10), cm(10), 0.5), w: cm(10), h: cm(10) });

const chestFace = nearestFace([0.08, Body.views(body, pos).chest.target[1], 0.3]);
const chestP = Body.anchorPoint(body, pos, { faceIndex: chestFace, bary: [1, 0, 0] });
const chestRegion = Body.region(body, pos, chestP, Body.surfaceNormal(body, pos, chestFace, chestP, 0.03));
console.log('chest region:', chestRegion);
assert(/chest|Sternum/.test(chestRegion), `chest region ${chestRegion}`);

// 5) Kotva se pohne s kůží
const anchor = { faceIndex: chestFace, bary: [0.3, 0.3, 0.4] };
const before = Body.anchorPoint(body, shape({}), anchor);
const after = Body.anchorPoint(body, shape({ weight: 2.5 }), anchor);
assert(Math.hypot(...before.map((v, i) => v - after[i])) > 0.005, 'anchor follows skin');

// 6) Oči mají duhovku a zornici; pásy prádla jsou rozumně umístěné (top jen u ženy)
const colors = Body.computeColors(body, shape({}), new Float32Array(body.n3));
let iris = 0;
for (let v = 0; v < meta.vertexCount; v++) if (body.isEye[v] && colors[v * 3] < 0.5) iris++;
assert(iris > 0, `iris=${iris}`);
const bands = Body.clothBands(body, shape({}), Body.DEFAULTS);
assert(bands.brief[0] < bands.brief[1] && bands.top[0] < bands.top[1] && bands.brief[1] < bands.top[0], 'cloth bands');
assert(Body.clothBands(body, shape({ gender: 1 }), { ...Body.DEFAULTS, gender: 1 }).top === null, 'no top for male');
for (const name in views) assert(views[name].target.every(Number.isFinite), `view ${name}`);
const skin = Body.surfaceArea(body, shape({}));
console.log('skin area cm²:', skin.toFixed(0));
assert(skin > 13000 && skin < 22000, `skin area ${skin}`); // dospělý ~1.5–2 m²

console.log('ALL OK');
