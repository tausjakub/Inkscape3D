// Zpracování obrázků tetování na "inkoust": styl (barva / černobílá / stencil), stárnutí,
// odstranění světlého pozadí. Výsledek je na bílém podkladu, protože se do kůže
// "násobí" (MultiplyBlending) – bílá = beze změny, černá = plný inkoust.
const Ink = (() => {
    const STYLES = ['color', 'bw', 'stencil'];
    const AGES = ['fresh', 'healed', 'aged'];
    const settings = { background: 0.9 }; // společné pro všechna tetování; styl a stáří má každé své
    const MAX_SIDE = 1024;

    const images = new Map();   // cesta -> Promise<HTMLImageElement>
    const textures = new Map(); // klíč -> THREE.Texture
    let version = 0;
    let onReady = () => {};

    function loadImage(path) {
        if (!images.has(path)) {
            images.set(path, new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error(`Cannot load image ${path.slice(0, 60)}`));
                img.src = path;
            }));
        }
        return images.get(path);
    }

    // Vykreslí obrázek do canvasu podle voleb; vrací Promise<canvas>
    async function render(path, opts = {}) {
        const o = { ...settings, style: 'bw', age: 'fresh', flip: false, fade: 0, maxSide: MAX_SIDE, ...opts };
        const img = await loadImage(path);
        const scale = Math.min(1, o.maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        if (o.flip) { ctx.translate(w, 0); ctx.scale(-1, 1); }
        ctx.drawImage(img, 0, 0, w, h);
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        const data = ctx.getImageData(0, 0, w, h);
        const px = data.data;
        const aged = o.age === 'aged', fade = o.fade + (o.age === 'healed' ? 0.08 : aged ? 0.22 : 0);
        for (let i = 0; i < px.length; i += 4) {
            let r = px[i], g = px[i + 1], b = px[i + 2];
            const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            if (lum >= o.background) { px[i] = px[i + 1] = px[i + 2] = 255; continue; }
            if (o.style === 'bw') r = g = b = lum * 255;
            else if (o.style === 'stencil') r = g = b = lum < 0.55 ? 0 : 255;
            if (aged) { // stará černá tuš zezelená / zmodrá
                const k = 0.35 * (1 - lum);
                r += (60 - r) * k; g += (78 - g) * k; b += (88 - b) * k;
            }
            px[i] = r + (255 - r) * fade;
            px[i + 1] = g + (255 - g) * fade;
            px[i + 2] = b + (255 - b) * fade;
        }
        ctx.putImageData(data, 0, 0);

        const blur = o.age === 'healed' ? 0.6 : aged ? 1.5 : 0;
        if (!blur) return canvas;
        const soft = document.createElement('canvas');
        soft.width = w;
        soft.height = h;
        const sctx = soft.getContext('2d');
        sctx.fillStyle = '#fff';
        sctx.fillRect(0, 0, w, h);
        sctx.filter = `blur(${blur * Math.max(w, h) / 512}px)`;
        sctx.drawImage(canvas, 0, 0);
        return soft;
    }

    // Podíl pixelů s inkoustem (znatelně tmavší než bílá kůže)
    function inkFraction(canvas) {
        const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 3 * 235) ink++;
        return ink / (px.length / 4);
    }

    // Textura pro 3D; dokud se obrázek zpracovává, je bílá (= neviditelná) a aspect = 1
    function texture(path, { flip = false, preview = false, style = 'bw', age = 'fresh' } = {}) {
        const key = `${version}|${flip}|${preview}|${style}|${age}|${path}`;
        if (textures.has(key)) return textures.get(key);
        const blank = document.createElement('canvas');
        blank.width = blank.height = 1;
        const tex = new THREE.CanvasTexture(blank);
        tex.minFilter = THREE.LinearFilter; // bez mipmap -> funguje i pro obrázky, které nejsou 2^n
        tex.generateMipmaps = false;
        tex.aspect = 1;
        textures.set(key, tex);
        render(path, { flip, style, age, fade: preview ? 0.45 : 0 }).then((canvas) => {
            tex.image = canvas;
            tex.aspect = canvas.width / canvas.height;
            tex.coverage = inkFraction(canvas);
            tex.needsUpdate = true;
            onReady();
        }).catch((e) => console.error(e));
        return tex;
    }

    function setSettings(next) {
        const bg = Number(next.background);
        if (bg >= 0.5 && bg <= 1) settings.background = bg;
        version++;
        textures.forEach((t) => t.dispose());
        textures.clear();
    }

    return {
        STYLES, AGES, settings, render, texture, setSettings, loadImage,
        set onReady(fn) { onReady = fn; },
    };
})();
