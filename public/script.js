// Základní nastavení scény
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(800, 600);
renderer.setClearColor(0x888888); // Šedé pozadí
document.getElementById('3d-container').appendChild(renderer.domElement);

// Osvětlení scény
const light = new THREE.AmbientLight(0xffffff, 1);
scene.add(light);

// Nastavení kamery
camera.position.set(0, 1.5, 5);
camera.lookAt(0, 1.5, 0);

// OrbitControls pro rotaci modelu myší
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 1;
controls.maxDistance = 100;

// Načítání modelu
const loader = new THREE.GLTFLoader();
let currentModel;

function loadModel(modelPath) {
    if (currentModel) {
        scene.remove(currentModel);
    }

    loader.load(
        modelPath,
        (gltf) => {
            currentModel = gltf.scene;
            scene.add(currentModel);
        },
        undefined,
        (error) => {
            console.error('Chyba při načítání modelu:', error);
        }
    );
}

// Výběr modelu
const modelSelector = document.getElementById('model-selector');
modelSelector.addEventListener('change', (event) => {
    loadModel(event.target.value);
});

// První načtení modelu
loadModel('/models/male_body.glb');

// Změna barvy pleti
const skinColorButtons = document.querySelectorAll('.skin-color');
skinColorButtons.forEach((button) => {
    button.addEventListener('click', () => {
        const selectedColor = button.getAttribute('data-color');
        if (!currentModel) return;

        currentModel.traverse((child) => {
            if (child.isMesh) {
                const material = child.material.clone();
                material.color.set(selectedColor); // Nastaví barvu materiálu
                material.map = null; // Odstraní tetování, pokud existuje
                material.needsUpdate = true;
                child.material = material;
            }
        });
    });
});

// Správa tetování
const tattoos = []; // Pole pro uchování všech tetování
let selectedTattoo = null; // Aktuálně vybrané tetování

function applyTattoo(texturePath) {
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(texturePath, (tattooTexture) => {
        if (!currentModel) return;

        const decalMaterial = new THREE.MeshPhongMaterial({
            map: tattooTexture,
            transparent: true,
            depthTest: true,
            depthWrite: false
        });

        let validMesh = null;
        currentModel.traverse((child) => {
            if (child.isMesh && child.geometry) {
                validMesh = child;
            }
        });

        if (!validMesh) {
            console.error('Tetování nelze aplikovat: žádná platná geometrie v modelu.');
            return;
        }

        const decalSize = new THREE.Vector3(1, 1, 1); // Výchozí velikost tetování
        const decalGeometry = new THREE.DecalGeometry(
            validMesh,
            new THREE.Vector3(0, 1.5, 0), // Výchozí pozice tetování
            new THREE.Euler(0, 0, 0),
            decalSize
        );

        const decalMesh = new THREE.Mesh(decalGeometry, decalMaterial);
        decalMesh.name = `Tattoo_${tattoos.length + 1}`; // Pojmenujeme tetování
        scene.add(decalMesh);
        tattoos.push(decalMesh); // Přidáme tetování do seznamu

        updateTattooList(); // Aktualizace seznamu tetování
    });
}

// Aktualizace seznamu tetování
function updateTattooList() {
    const tattooListContainer = document.getElementById('tattoo-list');
    tattooListContainer.innerHTML = ''; // Vyčistit starý seznam

    tattoos.forEach((tattoo, index) => {
        const button = document.createElement('button');
        button.textContent = `Tetování ${index + 1}`;
        button.addEventListener('click', () => {
            selectedTattoo = tattoo; // Nastavit aktuálně vybrané tetování
            highlightSelectedTattoo(index); // Zvýraznit vybrané tetování
        });
        tattooListContainer.appendChild(button);
    });
}

// Zvýraznění vybraného tetování v seznamu
function highlightSelectedTattoo(selectedIndex) {
    const buttons = document.querySelectorAll('#tattoo-list button');
    buttons.forEach((button, index) => {
        if (index === selectedIndex) {
            button.style.backgroundColor = '#ccc';
        } else {
            button.style.backgroundColor = '';
        }
    });
}

// Ovládání vybraného tetování
document.addEventListener('keydown', (event) => {
    if (!selectedTattoo) return; // Zkontrolovat, zda je vybrané tetování

    const controls = {
        moveUp: () => (selectedTattoo.position.y += 0.1),
        moveDown: () => (selectedTattoo.position.y -= 0.1),
        moveLeft: () => (selectedTattoo.position.x -= 0.1),
        moveRight: () => (selectedTattoo.position.x += 0.1),
        scaleUp: () => {
            selectedTattoo.scale.x += 0.1;
            selectedTattoo.scale.y += 0.1;
            selectedTattoo.scale.z += 0.1;
        },
        scaleDown: () => {
            selectedTattoo.scale.x = Math.max(0.1, selectedTattoo.scale.x - 0.1);
            selectedTattoo.scale.y = Math.max(0.1, selectedTattoo.scale.y - 0.1);
            selectedTattoo.scale.z = Math.max(0.1, selectedTattoo.scale.z - 0.1);
        }
    };

    switch (event.key.toLowerCase()) {
        case 'w': controls.moveUp(); break;
        case 's': controls.moveDown(); break;
        case 'a': controls.moveLeft(); break;
        case 'd': controls.moveRight(); break;
        case 'q': controls.scaleUp(); break;
        case 'e': controls.scaleDown(); break;
    }
});

// Generování tlačítek tetování
function generateTattooButtons(tattoos) {
    const tattooContainer = document.getElementById('tattoo-selector');
    tattooContainer.innerHTML = ''; // Vymazání existujících tlačítek

    tattoos.forEach((tattoo) => {
        const button = document.createElement('button');
        button.classList.add('tattoo-button');
        button.style.width = '80px';
        button.style.height = '80px';
        button.style.margin = '5px';
        button.style.backgroundImage = `url('/tattoos/${tattoo}')`;
        button.style.backgroundSize = 'contain';
        button.style.backgroundRepeat = 'no-repeat';
        button.style.backgroundPosition = 'center';
        button.setAttribute('data-path', `/tattoos/${tattoo}`);

        button.addEventListener('click', () => {
            applyTattoo(`/tattoos/${tattoo}`);
        });

        tattooContainer.appendChild(button);
    });
}


// Načtení seznamu tetování
(async function init() {
    const tattoos = await fetch('/api/tattoos').then((res) => res.json());
    generateTattooButtons(tattoos);
})();

// Animace
function animate() {
    requestAnimationFrame(animate);
    controls.update(); // Zajistí rotaci modelu
    renderer.render(scene, camera);
}
animate();
