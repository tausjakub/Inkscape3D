// Editor návrhů tetování: kreslení na průhledný canvas se symetrií (zrcadlo / mandala),
// text, čáry, kruhy, import obrázku, undo/redo. Výsledek se uloží jako PNG do knihovny.
const Editor = (() => {
    const SIZE = 1024;
    const dialog = document.getElementById('editor');
    const canvas = document.getElementById('editor-canvas');
    const ctx = canvas.getContext('2d');
    const $ = (id) => document.getElementById(id);
    canvas.width = canvas.height = SIZE;

    let tool = 'brush';
    let undoStack = [], redoStack = [];
    let drawing = null; // { last, start, snapshot }
    let onSave = () => {};

    const color = () => $('ed-color').value;
    const size = () => parseFloat($('ed-size').value);
    const symmetry = () => $('ed-symmetry').value;

    // Transformace pro symetrii kolem středu plátna
    function transforms() {
        const s = symmetry();
        if (s === 'none') return [{ angle: 0, mirror: false }];
        if (s === 'mirror') return [{ angle: 0, mirror: false }, { angle: 0, mirror: true }];
        const n = parseInt(s, 10);
        const list = [];
        for (let k = 0; k < n; k++) list.push({ angle: (2 * Math.PI * k) / n, mirror: false });
        if ($('ed-kaleido').checked) for (let k = 0; k < n; k++) list.push({ angle: (2 * Math.PI * k) / n, mirror: true });
        return list;
    }

    function withSymmetry(draw) {
        for (const t of transforms()) {
            ctx.save();
            ctx.translate(SIZE / 2, SIZE / 2);
            ctx.rotate(t.angle);
            if (t.mirror) ctx.scale(-1, 1);
            ctx.translate(-SIZE / 2, -SIZE / 2);
            draw();
            ctx.restore();
        }
    }

    function style() {
        ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
        ctx.strokeStyle = ctx.fillStyle = color();
        ctx.lineWidth = size();
        ctx.lineCap = ctx.lineJoin = 'round';
    }

    function pushUndo() {
        undoStack.push(ctx.getImageData(0, 0, SIZE, SIZE));
        if (undoStack.length > 30) undoStack.shift();
        redoStack = [];
        updateButtons();
    }

    function updateButtons() {
        $('ed-undo').disabled = !undoStack.length;
        $('ed-redo').disabled = !redoStack.length;
    }

    function point(e) {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width * SIZE, y: (e.clientY - r.top) / r.height * SIZE };
    }

    canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        const p = point(e);
        pushUndo();
        if (tool === 'text') {
            const text = $('ed-text').value.trim();
            if (!text) { $('ed-text').focus(); undoStack.pop(); updateButtons(); return; }
            style();
            ctx.font = `${size() * 4}px ${$('ed-font').value}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            withSymmetry(() => ctx.fillText(text, p.x, p.y));
            return;
        }
        drawing = { last: p, start: p, snapshot: ctx.getImageData(0, 0, SIZE, SIZE) };
        if (tool === 'brush' || tool === 'eraser') {
            style();
            withSymmetry(() => { ctx.beginPath(); ctx.arc(p.x, p.y, size() / 2, 0, Math.PI * 2); ctx.fill(); });
        }
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const p = point(e);
        style();
        if (tool === 'brush' || tool === 'eraser') {
            const a = drawing.last;
            withSymmetry(() => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(p.x, p.y); ctx.stroke(); });
            drawing.last = p;
        } else {
            // Čára / kruh: náhled = obnovit stav z začátku tahu a nakreslit znovu
            ctx.putImageData(drawing.snapshot, 0, 0);
            const s = drawing.start;
            withSymmetry(() => {
                ctx.beginPath();
                if (tool === 'line') { ctx.moveTo(s.x, s.y); ctx.lineTo(p.x, p.y); }
                else ctx.arc(s.x, s.y, Math.hypot(p.x - s.x, p.y - s.y), 0, Math.PI * 2);
                ctx.stroke();
            });
        }
    });

    const stop = () => { drawing = null; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);

    // Vodítka symetrie nad plátnem (jen zobrazení, neukládají se)
    function drawGuides() {
        const g = $('editor-guides');
        const s = symmetry();
        if (s === 'none') { g.innerHTML = ''; return; }
        if (s === 'mirror') { g.innerHTML = '<line x1="50" y1="0" x2="50" y2="100"/>'; return; }
        const n = parseInt(s, 10);
        g.innerHTML = Array.from({ length: n }, (_, k) => {
            const a = (2 * Math.PI * k) / n;
            return `<line x1="50" y1="50" x2="${50 + Math.sin(a) * 50}" y2="${50 - Math.cos(a) * 50}"/>`;
        }).join('');
    }

    function setTool(name) {
        tool = name;
        dialog.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === name));
        $('ed-text-row').hidden = name !== 'text';
    }

    dialog.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $('ed-symmetry').addEventListener('change', () => {
        $('ed-kaleido-row').hidden = ['none', 'mirror'].includes(symmetry());
        drawGuides();
    });
    $('ed-undo').addEventListener('click', () => {
        if (!undoStack.length) return;
        redoStack.push(ctx.getImageData(0, 0, SIZE, SIZE));
        ctx.putImageData(undoStack.pop(), 0, 0);
        updateButtons();
    });
    $('ed-redo').addEventListener('click', () => {
        if (!redoStack.length) return;
        undoStack.push(ctx.getImageData(0, 0, SIZE, SIZE));
        ctx.putImageData(redoStack.pop(), 0, 0);
        updateButtons();
    });
    $('ed-clear').addEventListener('click', () => { pushUndo(); ctx.clearRect(0, 0, SIZE, SIZE); });

    function drawImageFit(img) {
        const s = Math.min(SIZE * 0.9 / img.width, SIZE * 0.9 / img.height);
        const w = img.width * s, h = img.height * s;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    }

    $('ed-import').addEventListener('change', (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file || !file.type.startsWith('image/')) return;
        const img = new Image();
        img.onload = () => { pushUndo(); drawImageFit(img); URL.revokeObjectURL(img.src); };
        img.src = URL.createObjectURL(file);
    });

    // Ořízne průhledné okraje a vrátí PNG data URL (null, když je plátno prázdné)
    function exportTrimmed() {
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
        let x0 = SIZE, y0 = SIZE, x1 = -1, y1 = -1;
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
            if (data[(y * SIZE + x) * 4 + 3] < 8) continue;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 < 0) return null;
        const pad = 8;
        x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
        x1 = Math.min(SIZE - 1, x1 + pad); y1 = Math.min(SIZE - 1, y1 + pad);
        const out = document.createElement('canvas');
        out.width = x1 - x0 + 1;
        out.height = y1 - y0 + 1;
        out.getContext('2d').drawImage(canvas, -x0, -y0);
        return out.toDataURL('image/png');
    }

    $('ed-save').addEventListener('click', () => {
        const url = exportTrimmed();
        if (!url) { $('ed-status').textContent = 'Draw something first.'; return; }
        onSave(url, $('ed-name').value.trim() || 'My design');
        dialog.close();
    });
    $('ed-cancel').addEventListener('click', () => dialog.close());

    // Otevře editor; volitelně s obrázkem jako podkladem (úprava existujícího návrhu)
    function open({ src = null, name = '', save }) {
        onSave = save;
        ctx.clearRect(0, 0, SIZE, SIZE);
        undoStack = [];
        redoStack = [];
        updateButtons();
        $('ed-name').value = name;
        $('ed-status').textContent = '';
        setTool('brush');
        drawGuides();
        dialog.showModal();
        if (src) {
            const img = new Image();
            img.onload = () => drawImageFit(img);
            img.src = src;
        }
    }

    return { open };
})();
