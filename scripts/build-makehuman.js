// Sestaví models/makehuman.bin + .json z MakeHuman base.obj a .target souborů (CC0).
// Použití: node scripts/build-makehuman.js <složka s base.obj a targets/>
// Data: https://github.com/makehumancommunity/makehuman/tree/master/makehuman/data
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = process.argv[2];
if (!src) throw new Error('usage: node scripts/build-makehuman.js <source dir>');
const SCALE = 1000; // delty v int16 s přesností 1/1000 decimetru (0.1 mm)

// Měřicí smyčky z MakeHumanu (plugins/0_modeling_a_measurement.py, třída Ruler):
// obvod = délka lomené čáry přes tyto vrcholy, v decimetrech.
const MEASURES = {
    bust: [8439, 8455, 8462, 8446, 8478, 8494, 8557, 8510, 8526, 8542, 10720, 10601, 10603, 10602, 10612, 10611, 10610, 10613, 10604, 10605, 10606, 3942, 3941, 3940, 3950, 3947, 3948, 3949, 3938, 3939, 3937, 4065, 1870, 1854, 1838, 1885, 1822, 1806, 1774, 1790, 1783, 1767, 1799, 8471],
    underbust: [10750, 10744, 10724, 10725, 10748, 10722, 10640, 10642, 10641, 10651, 10650, 10649, 10652, 10643, 10644, 10645, 10646, 10647, 10648, 3988, 3987, 3986, 3985, 3984, 3983, 3982, 3992, 3989, 3990, 3991, 3980, 3981, 3979, 4067, 4098, 4073, 4072, 4094, 4100, 4082, 4088, 4088],
    waist: [4121, 10760, 10757, 10777, 10776, 10779, 10780, 10778, 10781, 10771, 10773, 10772, 10775, 10774, 10814, 10834, 10816, 10817, 10818, 10819, 10820, 10821, 4181, 4180, 4179, 4178, 4177, 4176, 4175, 4196, 4173, 4131, 4132, 4129, 4130, 4128, 4138, 4135, 4137, 4136, 4133, 4134, 4108, 4113, 4118, 4121],
    hips: [4341, 10968, 10969, 10971, 10970, 10967, 10928, 10927, 10925, 10926, 10923, 10924, 10868, 10875, 10861, 10862, 4228, 4227, 4226, 4242, 4234, 4294, 4293, 4296, 4295, 4297, 4298, 4342, 4345, 4346, 4344, 4343, 4361, 4341],
};

// base.obj: kůže ("body") + oční bulvy; ostatní pomocné skupiny (šaty, kostky kloubů) vynecháme
const lines = fs.readFileSync(path.join(src, 'base.obj'), 'utf8').split('\n');
const verts = [];
const bodyFaces = [];
const eyeFaces = [];
let group = '';
for (const line of lines) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') verts.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === 'g') group = p[1];
    else if (p[0] === 'f') {
        const target = group === 'body' ? bodyFaces
            : (group === 'helper-l-eye' || group === 'helper-r-eye') ? eyeFaces : null;
        if (!target) continue;
        const idx = p.slice(1).map((s) => parseInt(s, 10) - 1);
        for (let i = 1; i + 1 < idx.length; i++) target.push(idx[0], idx[i], idx[i + 1]);
    }
}
const faces = bodyFaces.concat(eyeFaces);

// Přečíslování jen na použité vrcholy
const remap = new Map();
faces.forEach((v) => { if (!remap.has(v)) remap.set(v, remap.size); });
const n = remap.size;
assert(n > 0 && n < 65536, `vertex count ${n}`);
const positions = new Float32Array(n * 3);
remap.forEach((to, from) => positions.set(verts[from], to * 3));
const indices = Uint16Array.from(faces, (v) => remap.get(v));

const measures = {};
for (const name in MEASURES) {
    measures[name] = MEASURES[name].map((v) => {
        assert(remap.has(v), `measure ${name}: vertex ${v} not in body`);
        return remap.get(v);
    });
}

// Etnické targety (african/asian/caucasian-<pohlaví>-<věk>) nesou hlavní tvar pohlaví a věku.
// Smícháme je v poměru 1/3 jako výchozí MakeHuman -> "ethnic-<pohlaví>-<věk>".
const targetDir = path.join(src, 'targets');
const combined = new Map(); // název -> { sum: Float32Array, count }
for (const file of fs.readdirSync(targetDir).filter((f) => f.endsWith('.target'))) {
    const name = file.replace('.target', '').replace(/^(african|asian|caucasian)-/, 'ethnic-');
    if (!combined.has(name)) combined.set(name, { sum: new Float32Array(n * 3), count: 0 });
    const entry = combined.get(name);
    entry.count++;
    for (const line of fs.readFileSync(path.join(targetDir, file), 'utf8').split('\n')) {
        if (!line || line[0] === '#') continue;
        const [i, x, y, z] = line.trim().split(/\s+/).map(Number);
        const to = remap.get(i);
        if (to === undefined) continue; // vrchol mimo tělo
        entry.sum[to * 3] += x;
        entry.sum[to * 3 + 1] += y;
        entry.sum[to * 3 + 2] += z;
    }
}
const names = [...combined.keys()].sort();
const deltas = new Int16Array(names.length * n * 3);
names.forEach((name, t) => {
    const { sum, count } = combined.get(name);
    for (let j = 0; j < n * 3; j++) {
        const q = Math.round(sum[j] / count * SCALE);
        assert(Math.abs(q) < 32767, `${name}: delta out of range`);
        deltas[t * n * 3 + j] = q;
    }
});

const out = path.join(__dirname, '..', 'models');
fs.writeFileSync(path.join(out, 'makehuman.bin'), Buffer.concat([
    Buffer.from(positions.buffer), Buffer.from(indices.buffer), Buffer.from(deltas.buffer),
]));
fs.writeFileSync(path.join(out, 'makehuman.json'), JSON.stringify({
    license: 'CC0 1.0 - MakeHuman base mesh and targets (makehumancommunity/makehuman)',
    vertexCount: n,
    indexCount: indices.length,
    bodyIndexCount: bodyFaces.length, // indexy [0, bodyIndexCount) = kůže, zbytek = oči
    deltaScale: 1 / SCALE,
    measures,
    targets: names,
}));
console.log(`vertices ${n}, body triangles ${bodyFaces.length / 3}, eye triangles ${eyeFaces.length / 3}, targets ${names.length}`);
