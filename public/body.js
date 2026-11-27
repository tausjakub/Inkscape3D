// Nastavitelné tělo (MakeHuman, CC0): tvar, míry, barvy, pohledy kamery a plochy pro tetování.
// Bez DOMu – stejný kód běží v prohlížeči i v Node testu (scripts/check-body.js).
const Body = (() => {
    const MH_SCALE = 0.12;   // decimetry MakeHumanu -> jednotky scény (průměrné tělo ~2 jednotky)
    const DM_TO_CM = 10;
    const DENSITY = 1.0;     // kg na litr (dm³); lidské tělo má hustotu cca 0.98–1.06

    // Parametry sliderů. 0..1 (0.5 = průměr) nebo -1..1 (0 = beze změny)
    const DEFAULTS = {
        gender: 0, age: 0, height: 0.5, weight: 0.5, muscle: 0.5,
        bust: 0, waist: 0, hips: 0, legs: 0,
    };
    // Výška 0.1..0.9 ≈ 130–215 cm. Váha jde za meze MakeHumanu (lineární extrapolace targetů),
    // aby šla nastavit i hubenější / těžší postava.
    const RANGES = {
        height: [0.1, 0.9], weight: [-0.5, 2.5],
        bust: [-1, 1], waist: [-1, 1], hips: [-1, 1], legs: [-1, 1],
    };
    const range = (param) => RANGES[param] || [0, 1];
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const MEASURE_TARGETS = {
        bust: ['bust-circ'], waist: ['waist-circ'], hips: ['hips-circ'],
        legs: ['upperleg-height', 'lowerleg-height'],
    };
    // Která míra se ovládá kterým parametrem (pro zadání čísla do políčka)
    const FIT_PARAM = { height: 'height', weight: 'weight', chest: 'bust', waist: 'waist', hips: 'hips', inseam: 'legs' };
    const AGE_YEARS = [25, 90]; // age 0 = 25 let ("young" target), 1 = 90 let ("old" target)

    // Rozdělí hodnotu 0..1 mezi min / average / max (0.5 = čistě average)
    function splitMinAvgMax(v) {
        const min = Math.max(0, 1 - 2 * v), max = Math.max(0, 2 * v - 1);
        return { min, average: 1 - min - max, max };
    }

    // Váhy targetů stejně jako MakeHuman: pohlaví × svaly × váha (× věk / výška)
    function targetWeights(p) {
        const weights = {};
        const G = { female: 1 - p.gender, male: p.gender };
        const A = { young: 1 - p.age, old: p.age };
        const M = splitMinAvgMax(p.muscle), W = splitMinAvgMax(p.weight), H = splitMinAvgMax(p.height);
        // Hlavní tvar pohlaví a věku (etnické targety smíchané při buildu)
        for (const g in G) for (const a in A) weights[`ethnic-${g}-${a}`] = G[g] * A[a];
        for (const g in G) for (const m in M) for (const w in W) {
            const k = G[g] * M[m] * W[w];
            if (!k) continue;
            for (const a in A) weights[`universal-${g}-${a}-${m}muscle-${w}weight`] = k * A[a];
            // shortcut: výškové targety existují jen pro "young"; pro starší tělo se použijí také
            weights[`${g}-young-${m}muscle-${w}weight-minheight`] = k * H.min;
            weights[`${g}-young-${m}muscle-${w}weight-maxheight`] = k * H.max;
        }
        for (const param in MEASURE_TARGETS) for (const t of MEASURE_TARGETS[param]) {
            weights[`measure-${t}-incr`] = Math.max(0, p[param]);
            weights[`measure-${t}-decr`] = Math.max(0, -p[param]);
        }
        return weights;
    }

    function create(meta, buffer) {
        const n3 = meta.vertexCount * 3;
        const body = {
            meta,
            n3,
            base: new Float32Array(buffer, 0, n3),
            indices: new Uint16Array(buffer, n3 * 4, meta.indexCount),
            deltas: new Int16Array(buffer, n3 * 4 + meta.indexCount * 2, meta.targets.length * n3),
            bodyTriCount: meta.bodyIndexCount / 3,
        };
        body.isEye = new Uint8Array(meta.vertexCount);
        for (let i = meta.bodyIndexCount; i < meta.indexCount; i++) body.isEye[body.indices[i]] = 1;

        // Vrchol -> trojúhelníky kůže (CSR), pro souvislé plochy pod tetováním
        const counts = new Uint32Array(meta.vertexCount + 1);
        for (let i = 0; i < meta.bodyIndexCount; i++) counts[body.indices[i] + 1]++;
        for (let v = 0; v < meta.vertexCount; v++) counts[v + 1] += counts[v];
        const fill = counts.slice(0, -1);
        body.vtOffsets = counts;
        body.vtTris = new Uint32Array(meta.bodyIndexCount);
        for (let i = 0; i < meta.bodyIndexCount; i++) body.vtTris[fill[body.indices[i]]++] = (i / 3) | 0;

        // Rozkrok = nejnižší vrchol na středové ose v dolní polovině trupu (pro délku nohou)
        const pos = computePositions(body, DEFAULTS, new Float32Array(n3));
        const { minY, maxY } = bounds(body, pos);
        let crotch = -1;
        for (let v = 0; v < meta.vertexCount; v++) {
            const x = pos[v * 3], y = pos[v * 3 + 1];
            if (body.isEye[v] || Math.abs(x) > 1e-4 || y < minY + 0.35 * (maxY - minY)) continue;
            if (crotch < 0 || y < pos[crotch * 3 + 1]) crotch = v;
        }
        body.crotch = crotch;
        return body;
    }

    // Pozice vrcholů pro dané parametry, v jednotkách scény (zapisuje do out)
    function computePositions(body, params, out) {
        const n3 = body.n3;
        out.set(body.base);
        const weights = targetWeights(params);
        body.meta.targets.forEach((name, t) => {
            const k = weights[name];
            if (!k) return;
            const s = k * body.meta.deltaScale, off = t * n3;
            for (let i = 0; i < n3; i++) out[i] += body.deltas[off + i] * s;
        });
        for (let i = 0; i < n3; i++) out[i] *= MH_SCALE;
        return out;
    }

    function bounds(body, pos) {
        let minY = Infinity, maxY = -Infinity;
        for (let v = 0; v < body.meta.vertexCount; v++) {
            if (body.isEye[v]) continue;
            const y = pos[v * 3 + 1];
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        return { minY, maxY };
    }

    const loopLength = (pos, loop) => {
        let sum = 0;
        for (let i = 1; i < loop.length; i++) {
            const a = loop[i - 1] * 3, b = loop[i] * 3;
            sum += Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]);
        }
        return sum;
    };
    const loopY = (pos, loop) => loop.reduce((s, v) => s + pos[v * 3 + 1], 0) / loop.length;
    const loopHalfWidth = (pos, loop) => Math.max(...loop.map((v) => Math.abs(pos[v * 3])));

    // Objem uzavřeného meshe (věta o divergenci); díry po očích jsou zanedbatelné
    function volume(body, pos) {
        const idx = body.indices;
        let vol = 0;
        for (let i = 0; i < body.meta.bodyIndexCount; i += 3) {
            const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
            vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
                - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
                + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
        }
        return Math.abs(vol) / 6;
    }

    const toCm = (units) => units / MH_SCALE * DM_TO_CM;

    // Skutečné míry: výška, váha (z objemu), obvody hrudníku/pasu/boků (MakeHuman smyčky), vnitřní délka nohy
    function measure(body, pos, only) {
        const m = {};
        const want = (k) => !only || only === k;
        const ms = body.meta.measures;
        if (want('height') || want('inseam')) {
            const { minY, maxY } = bounds(body, pos);
            m.height = toCm(maxY - minY);
            m.inseam = toCm(pos[body.crotch * 3 + 1] - minY);
        }
        if (want('weight')) m.weight = volume(body, pos) / MH_SCALE ** 3 * DENSITY;
        if (want('chest')) m.chest = toCm(loopLength(pos, ms.bust));
        if (want('waist')) m.waist = toCm(loopLength(pos, ms.waist));
        if (want('hips')) m.hips = toCm(loopLength(pos, ms.hips));
        return m;
    }

    // Najde hodnotu parametru, při které má míra `key` hodnotu `target` (bisekce, ostatní parametry beze změny)
    function fit(body, params, key, target) {
        const param = FIT_PARAM[key];
        const scratch = new Float32Array(body.n3);
        const at = (v) => measure(body, computePositions(body, { ...params, [param]: v }, scratch), key)[key];
        let [lo, hi] = range(param);
        let fLo = at(lo), fHi = at(hi);
        const increasing = fHi >= fLo;
        if (!increasing) { [lo, hi] = [hi, lo]; [fLo, fHi] = [fHi, fLo]; }
        if (target <= fLo) return lo;
        if (target >= fHi) return hi;
        for (let i = 0; i < 20; i++) {
            const mid = (lo + hi) / 2;
            if (at(mid) < target) lo = mid;
            else hi = mid;
        }
        return (lo + hi) / 2;
    }

    // Spodní prádlo jako pásy [yMin, yMax, max |x|]; kreslí je shader po pixelech (ostré rovné okraje)
    function clothBands(body, pos, params) {
        const ms = body.meta.measures;
        const { minY, maxY } = bounds(body, pos);
        const H = maxY - minY;
        const crotchY = pos[body.crotch * 3 + 1];
        const hipsY = loopY(pos, ms.hips), waistY = loopY(pos, ms.waist);
        const bustY = loopY(pos, ms.bust), underY = loopY(pos, ms.underbust);
        return {
            brief: [crotchY - 0.035 * H, hipsY + 0.45 * (waistY - hipsY), loopHalfWidth(pos, ms.hips) * 1.3],
            top: params.gender < 0.5
                ? [underY - 0.015 * H, bustY + 1.1 * (bustY - underY), loopHalfWidth(pos, ms.bust) * 1.02]
                : null,
        };
    }

    // Barvy vrcholů očí: bělmo, duhovka, zornice (kůže zůstává bílá = barva materiálu)
    const SCLERA = [0.95, 0.94, 0.92], IRIS = [0.32, 0.2, 0.12], PUPIL = [0.03, 0.03, 0.03];
    function computeColors(body, pos, out) {
        out.fill(1);
        const nv = body.meta.vertexCount;
        const set = (v, c) => { out[v * 3] = c[0]; out[v * 3 + 1] = c[1]; out[v * 3 + 2] = c[2]; };

        // Oči: střed a poloměr každé bulvy, přední část (+z) = duhovka a zornice
        for (const side of [1, -1]) {
            const verts = [];
            for (let v = 0; v < nv; v++) if (body.isEye[v] && Math.sign(pos[v * 3]) === side) verts.push(v);
            if (!verts.length) continue;
            const c = [0, 1, 2].map((k) => verts.reduce((s, v) => s + pos[v * 3 + k], 0) / verts.length);
            const r = Math.max(...verts.map((v) => Math.hypot(pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2])));
            for (const v of verts) {
                const t = (pos[v * 3 + 2] - c[2]) / r;
                set(v, t > 0.95 ? PUPIL : t > 0.8 ? IRIS : SCLERA);
            }
        }
        return out;
    }

    // Předvolené pohledy kamery, spočítané z aktuálního tvaru těla (tělo se dívá ve směru +z)
    function views(body, pos) {
        const { minY, maxY } = bounds(body, pos);
        const H = maxY - minY, cy = (minY + maxY) / 2;
        const ms = body.meta.measures;
        const bustY = loopY(pos, ms.bust), crotchY = pos[body.crotch * 3 + 1];
        const armX = loopHalfWidth(pos, ms.hips) * 1.3;
        // Loket: vrcholy paže mezi hrudníkem a pasem (ve výšce pasu už je zápěstí; ruka má hodně
        // vrcholů a průměr celé paže by táhla ven do prázdna)
        const elbowY = (bustY + loopY(pos, ms.waist)) / 2;
        const arm = (side) => {
            const c = [0, 0, 0];
            let n = 0;
            for (let v = 0; v < body.meta.vertexCount; v++) {
                const y = pos[v * 3 + 1];
                if (body.isEye[v] || pos[v * 3] * side < armX || Math.abs(y - elbowY) > 0.03 * H) continue;
                c[0] += pos[v * 3]; c[1] += pos[v * 3 + 1]; c[2] += pos[v * 3 + 2]; n++;
            }
            return c.map((s) => s / Math.max(1, n));
        };
        return {
            front: { target: [0, cy, 0], dir: [0, 0, 1], dist: 1.45 * H },
            back: { target: [0, cy, 0], dir: [0, 0, -1], dist: 1.45 * H },
            left: { target: [0, cy, 0], dir: [1, 0, 0], dist: 1.45 * H },
            right: { target: [0, cy, 0], dir: [-1, 0, 0], dist: 1.45 * H },
            chest: { target: [0, bustY, 0], dir: [0, 0.1, 1], dist: 0.55 * H },
            upperBack: { target: [0, bustY + 0.03 * H, 0], dir: [0, 0.1, -1], dist: 0.55 * H },
            leftArm: { target: arm(1), dir: [0.3, 0, 1], dist: 0.6 * H },
            rightArm: { target: arm(-1), dir: [-0.3, 0, 1], dist: 0.6 * H },
            legs: { target: [0, (minY + crotchY) / 2, 0], dir: [0, 0, 1], dist: 0.8 * H },
        };
    }

    // Kotva tetování = trojúhelník kůže + barycentrické souřadnice -> aktuální bod
    function anchorPoint(body, pos, anchor) {
        const i = anchor.faceIndex * 3;
        const p = [0, 0, 0];
        [0, 1, 2].forEach((k) => {
            const v = body.indices[i + k] * 3;
            for (let d = 0; d < 3; d++) p[d] += pos[v + d] * anchor.bary[k];
        });
        return p;
    }

    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const normalize = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
    const vec = (pos, v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    function triNormal(body, pos, t) { // délka = 2× plocha
        const i = body.indices;
        const a = vec(pos, i[t * 3]);
        return cross(sub(vec(pos, i[t * 3 + 1]), a), sub(vec(pos, i[t * 3 + 2]), a));
    }

    // Průměrná normála souvislé kůže do poloměru kolem bodu (vždy včetně trojúhelníku pod kurzorem)
    function surfaceNormal(body, pos, faceIndex, center, radius) {
        const idx = body.indices;
        const near = (t) => [0, 1, 2].some((k) => Math.hypot(...sub(vec(pos, idx[t * 3 + k]), center)) < radius);
        const seen = new Uint8Array(body.bodyTriCount);
        const queue = [faceIndex];
        seen[faceIndex] = 1;
        const normal = [0, 0, 0];
        while (queue.length) {
            const t = queue.pop();
            const n = triNormal(body, pos, t);
            for (let d = 0; d < 3; d++) normal[d] += n[d];
            for (let k = 0; k < 3; k++) {
                const v = idx[t * 3 + k];
                for (let j = body.vtOffsets[v]; j < body.vtOffsets[v + 1]; j++) {
                    const u = body.vtTris[j];
                    if (seen[u] || !near(u)) continue;
                    seen[u] = 1;
                    queue.push(u);
                }
            }
        }
        return normalize(normal);
    }

    // Tetování jako nálepka: kůže se kolem kotvy "rozvine" do 2D (diskrétní exponenciální mapa,
    // Schmidt et al. 2006) – velký motiv tak obtočí paži, nohu, bok nebo krk místo aby se
    // promítl jen zepředu. Šíří se jen po souvislé kůži, takže nepřeskočí z paže na trup.
    // Vrací trojúhelníky s UV (0..1 = obrázek), width/height v jednotkách scény, rotation v rad (po směru hod.).
    function wrapPatch(body, pos, anchor, width, height, rotation = 0) {
        const idx = body.indices, nv = body.meta.vertexCount;
        const center = anchorPoint(body, pos, anchor);
        const diag = Math.hypot(width, height) / 2;
        const n0 = surfaceNormal(body, pos, anchor.faceIndex, center, clamp(diag * 0.25, 0.012, 0.05));

        // Rám v kotvě: e2 = "nahoru" obrázku, e1 = doprava při pohledu zvenku, pak rotace
        const up = Math.abs(n0[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
        const u0 = normalize(sub(up, n0.map((x) => x * dot(up, n0))));
        const r0 = cross(u0, n0);
        const c = Math.cos(rotation), s = Math.sin(rotation);
        const e1 = r0.map((x, k) => c * x - s * u0[k]);
        const e2 = r0.map((x, k) => s * x + c * u0[k]);

        const vertexNormal = (v) => {
            const n = [0, 0, 0];
            for (let j = body.vtOffsets[v]; j < body.vtOffsets[v + 1]; j++) {
                const tn = triNormal(body, pos, body.vtTris[j]);
                n[0] += tn[0]; n[1] += tn[1]; n[2] += tn[2];
            }
            return normalize(n);
        };
        // Přenos rámu na jinou normálu (promítnutí do nové tečné roviny)
        const frames = new Float32Array(nv * 9); // e1, e2, n
        const setFrame = (v, f1, n) => {
            let a = normalize(sub(f1, n.map((x) => x * dot(f1, n))));
            if (!Number.isFinite(a[0]) || Math.hypot(...a) < 0.5) a = cross(n, [0, 1, 0]);
            const b = cross(n, a);
            frames.set([...a, ...b, ...n], v * 9);
        };
        const frameOf = (v) => [frames.subarray(v * 9, v * 9 + 3), frames.subarray(v * 9 + 3, v * 9 + 6), frames.subarray(v * 9 + 6, v * 9 + 9)];
        // 2D posun z u do v v tečné rovině u, se zachovanou délkou hrany
        const step = (u, v) => {
            const d = sub(vec(pos, v), vec(pos, u));
            const [a, b, n] = frameOf(u);
            const dn = dot(d, n);
            const t = [d[0] - n[0] * dn, d[1] - n[1] * dn, d[2] - n[2] * dn];
            const k = Math.hypot(...d) / (Math.hypot(...t) || 1);
            return [dot(t, a) * k, dot(t, b) * k];
        };

        // Dijkstra od vrcholů trojúhelníku pod kotvou
        const dist = new Float32Array(nv).fill(Infinity);
        const parent = new Int32Array(nv).fill(-1);
        const done = new Uint8Array(nv);
        const uv = new Float32Array(nv * 2);
        const heap = [];
        const push = (d, v) => {
            heap.push([d, v]);
            for (let i = heap.length - 1; i > 0;) {
                const p = (i - 1) >> 1;
                if (heap[p][0] <= heap[i][0]) break;
                [heap[p], heap[i]] = [heap[i], heap[p]];
                i = p;
            }
        };
        const pop = () => {
            const top = heap[0], last = heap.pop();
            if (heap.length) {
                heap[0] = last;
                for (let i = 0; ;) {
                    const l = i * 2 + 1, r = l + 1;
                    let m = i;
                    if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                    if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                    if (m === i) break;
                    [heap[m], heap[i]] = [heap[i], heap[m]];
                    i = m;
                }
            }
            return top;
        };
        for (let k = 0; k < 3; k++) {
            const v = idx[anchor.faceIndex * 3 + k];
            dist[v] = Math.hypot(...sub(vec(pos, v), center));
            push(dist[v], v);
        }
        const maxR = diag * 1.25 + 0.01;
        const reached = [];
        while (heap.length) {
            const [d, v] = pop();
            if (done[v] || d > dist[v]) continue;
            const n = vertexNormal(v);
            const p = parent[v];
            if (p < 0) { // vrchol trojúhelníku pod kotvou: přímo v tečné rovině kotvy
                const l = sub(vec(pos, v), center);
                uv[v * 2] = dot(l, e1);
                uv[v * 2 + 1] = dot(l, e2);
                setFrame(v, e1, n);
            } else {
                // průměr předpovědí od hotových sousedů, kteří souhlasí s rodičem
                // (na druhé straně obtočené paže se potkají dva "konce" – ty nemíchat)
                const sp = step(p, v);
                const base = [uv[p * 2] + sp[0], uv[p * 2 + 1] + sp[1]];
                let sx = 0, sy = 0, sw = 0;
                for (let j = body.vtOffsets[v]; j < body.vtOffsets[v + 1]; j++) {
                    const t = body.vtTris[j];
                    for (let k = 0; k < 3; k++) {
                        const u = idx[t * 3 + k];
                        if (u === v || !done[u]) continue;
                        const su = step(u, v);
                        const q = [uv[u * 2] + su[0], uv[u * 2 + 1] + su[1]];
                        const len = Math.hypot(...su) || 1e-6;
                        if (Math.hypot(q[0] - base[0], q[1] - base[1]) > len) continue;
                        sx += q[0] / len; sy += q[1] / len; sw += 1 / len;
                    }
                }
                uv[v * 2] = sw ? sx / sw : base[0];
                uv[v * 2 + 1] = sw ? sy / sw : base[1];
                setFrame(v, frameOf(p)[0], n);
            }
            done[v] = 1;
            reached.push(v);
            if (d > maxR) continue;
            for (let j = body.vtOffsets[v]; j < body.vtOffsets[v + 1]; j++) {
                const t = body.vtTris[j];
                for (let k = 0; k < 3; k++) {
                    const w = idx[t * 3 + k];
                    if (done[w]) continue;
                    const nd = d + Math.hypot(...sub(vec(pos, w), vec(pos, v)));
                    if (nd < dist[w]) { dist[w] = nd; parent[w] = v; push(dist[w], w); } // float32 hodnota, ať sedí test "zastaralý záznam"
                }
            }
        }

        // Trojúhelníky, které zasahují do obdélníku obrázku; švy (kde se obtočený motiv
        // potká sám se sebou) poznáme podle hrany, která je ve 2D mnohem delší než na kůži
        const positions = [], uvs = [];
        const hw = width / 2, hh = height / 2;
        const usedTri = new Uint8Array(body.bodyTriCount);
        for (const v of reached) {
            for (let j = body.vtOffsets[v]; j < body.vtOffsets[v + 1]; j++) {
                const t = body.vtTris[j];
                if (usedTri[t]) continue;
                usedTri[t] = 1;
                const vs = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
                if (!vs.every((x) => done[x])) continue;
                const xs = vs.map((x) => uv[x * 2]), ys = vs.map((x) => uv[x * 2 + 1]);
                if (Math.max(...xs) < -hw || Math.min(...xs) > hw || Math.max(...ys) < -hh || Math.min(...ys) > hh) continue;
                const seam = [0, 1, 2].some((k) => {
                    const a = vs[k], b = vs[(k + 1) % 3];
                    const d2 = Math.hypot(uv[a * 2] - uv[b * 2], uv[a * 2 + 1] - uv[b * 2 + 1]);
                    return d2 > 2 * Math.hypot(...sub(vec(pos, a), vec(pos, b))) + 1e-6;
                });
                if (seam) continue;
                for (const x of vs) {
                    positions.push(pos[x * 3], pos[x * 3 + 1], pos[x * 3 + 2]);
                    uvs.push(uv[x * 2] / width + 0.5, uv[x * 2 + 1] / height + 0.5);
                }
            }
        }
        return { positions, uvs, normal: n0, center };
    }

    // Plocha kůže v cm² (pro "kolik procent těla je potetováno")
    function surfaceArea(body, pos) {
        let a = 0;
        for (let t = 0; t < body.bodyTriCount; t++) a += Math.hypot(...triNormal(body, pos, t)) / 2;
        return a * toCm(1) ** 2;
    }

    // Název místa na těle (pro seznam a tiskový list pro tatéra). Tělo: +z = vpředu, +x = levá strana.
    function region(body, pos, p, n) {
        const { minY, maxY } = bounds(body, pos);
        const H = maxY - minY;
        const ms = body.meta.measures;
        const crotchY = pos[body.crotch * 3 + 1];
        const bustY = loopY(pos, ms.bust), waistY = loopY(pos, ms.waist);
        const [x, y] = p;
        const ax = Math.abs(x);
        const side = x > 0 ? 'Left' : 'Right';
        const back = n[2] < -0.3;

        if (y > maxY - 0.11 * H) return 'Head';
        if (y > maxY - 0.15 * H) return back ? 'Back of neck' : 'Neck';

        const torsoX = (y > bustY ? loopHalfWidth(pos, ms.bust) : loopHalfWidth(pos, ms.hips)) * 1.08;
        if (ax > torsoX && y > crotchY - 0.1 * H) {
            if (y > bustY + 0.04 * H && ax < torsoX * 1.6) return `${side} shoulder`;
            const part = y > waistY ? 'upper arm' : y > crotchY + 0.01 * H ? 'forearm' : 'hand';
            return `${side} ${part}`;
        }
        if (y >= crotchY) {
            if (Math.abs(n[0]) > 0.75) return `${side} ribs`;
            if (back) return y > waistY ? 'Upper back' : 'Lower back';
            if (y > bustY - 0.04 * H) return ax < 0.025 * H ? 'Sternum' : `${side} chest`;
            if (y > waistY) return ax > torsoX * 0.6 ? `${side} ribs` : 'Upper stomach';
            return ax > torsoX * 0.6 ? `${side} hip` : 'Lower stomach';
        }
        const fromFloor = (y - minY) / H;
        if (fromFloor > 0.3) return `${side} ${back ? 'back of thigh' : 'thigh'}`;
        if (fromFloor > 0.06) return `${side} ${back ? 'calf' : 'shin'}`;
        return `${side} ${fromFloor > 0.035 ? 'ankle' : 'foot'}`;
    }

    return {
        DEFAULTS, AGE_YEARS, FIT_PARAM, MH_SCALE, range, targetWeights, region,
        create, computePositions, measure, fit, computeColors, clothBands, views, anchorPoint, surfaceNormal, wrapPatch, surfaceArea, bounds, toCm,
    };
})();

if (typeof module !== 'undefined') module.exports = Body;
