// Základní nastavení scény (vytvoření scény, kamery a rendereru)
const scene = new THREE.Scene(); 
// Perspektivní kamera: zorné pole (FOV) = 75°, poměr stran 800/600, od 0.1 do 1000
const camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000); 
// WebGLRenderer pro vykreslování 3D scény do HTML
const renderer = new THREE.WebGLRenderer(); 

// Nastavení velikosti vykreslovací plochy
renderer.setSize(800, 600); 
// Nastavení barvy pozadí (šedá)
renderer.setClearColor(0x888888); 
// Připojení rendereru do divu s id "3d-container"
document.getElementById('3d-container').appendChild(renderer.domElement);

// Přidání základního (ambientního) světla do scény
// AmbientLight ovlivňuje všechny objekty ve scéně rovnoměrně
const light = new THREE.AmbientLight(0xffffff, 1);
scene.add(light);

// Nastavení pozice kamery tak, aby byla blíže k modelu
camera.position.set(0, 1.5, 12); // X=0, Y=1.5, Z=12
// Kamera bude směřovat k bodu (0,1,0) — střed modelu
camera.lookAt(0, 1, 0);

// OrbitControls umožňují uživateli otáčet, zoomovat a posouvat kamerou myší
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;        // Umožňuje plynulé „zpomalení“ pohybu
controls.dampingFactor = 0.05;        // Míra zpomalení
controls.minDistance = 1;            // Minimální vzdálenost kamery
controls.maxDistance = 100;          // Maximální vzdálenost kamery

// GLTFLoader slouží k načítání 3D modelů ve formátu GLTF/GLB
const loader = new THREE.GLTFLoader();
let currentModel; // Proměnná pro uchování aktuálně načteného 3D modelu

// Funkce pro načtení modelu z dané cesty (modelPath)
function loadModel(modelPath) {
    // Pokud už nějaký model je ve scéně, odstraníme ho
    if (currentModel) {
        scene.remove(currentModel); 

        // Odstranění všech tetování, která byla k modelu přidaná
        tattoos.forEach(tattoo => scene.remove(tattoo));
        tattoos.length = 0; // Vyprázdnění pole s tetováními
        updateTattooList(); // Aktualizace uživatelského rozhraní se seznamem tetování
    }

    // Načtení modelu pomocí loaderu
    loader.load(
        modelPath,
        (gltf) => {
            // Po úspěšném načtení se model uloží do currentModel
            currentModel = gltf.scene;

            // Traverse projde všechny potomky (uzly) modelu
            // a pro každý mesh nastaví materiál s bílou barvou.
            currentModel.traverse((child) => {
                if (child.isMesh) {
                    const whiteMaterial = new THREE.MeshStandardMaterial({
                        color: 0xffffff, // Bílá barva
                        roughness: 0.8,  // Hodnota "drsnosti" povrchu
                        metalness: 0.1,  // Hodnota "kovovosti" povrchu
                    });
                    child.material = whiteMaterial; 
                }
            });

            // Vypočítáme velikost bounding boxu modelu a normalizujeme jej
            // na požadovanou výšku (desiredHeight = 2)
            const box = new THREE.Box3().setFromObject(currentModel);
            const size = new THREE.Vector3();
            box.getSize(size);

            const desiredHeight = 2; 
            const scale = desiredHeight / size.y; // Poměr pro škálování výšky
            currentModel.scale.set(scale, scale, scale);

            // Rotace modelu, aby byl natočen tak, jak potřebujeme 
            // (čelem ke kameře, apod.)
            currentModel.rotation.y = Math.PI;      // 180° kolem Y
            currentModel.rotation.x = Math.PI * 0.5; 
            currentModel.rotation.z = Math.PI;      

            // Posunutí modelu dolů, aby byl střed zhruba ve správné poloze
            currentModel.position.set(0, -6, 0);

            // Přidání modelu do scény
            scene.add(currentModel);
        },
        undefined,
        (error) => {
            // Ošetření chyby při načítání
            console.error('Error loading model:', error);
        }
    );
}

// Výchozí Euler rotace, která se použije jako základ pro náhled tetování
let previewRotation = new THREE.Euler(0, 0, 0);

// Konzolové výpisy pro kontrolu (lze odstranit nebo ponechat pro ladění)
console.log('Scene contents:', scene.children);
console.log('Camera position:', camera.position);
console.log('Renderer size:', renderer.getSize(new THREE.Vector2()));

// Selektor (select) pro výběr modelu (např. mužské nebo ženské tělo)
const modelSelector = document.getElementById('model-selector');
modelSelector.addEventListener('change', (event) => {
    // Načteme nově vybraný model
    loadModel(event.target.value);
});

// První (výchozí) načtení modelu
loadModel('/models/male_body.glb');

// Změna barvy pleti
const skinColorButtons = document.querySelectorAll('.skin-color');
skinColorButtons.forEach((button) => {
    button.addEventListener('click', () => {
        const selectedColor = button.getAttribute('data-color');
        if (!currentModel) return;

        // Pro každý mesh v modelu vytvoříme nový materiál a nastavíme zvolenou barvu
        currentModel.traverse((child) => {
            if (child.isMesh) {
                const material = child.material.clone();
                material.color.set(selectedColor);
                material.map = null;        // Odstranění textury (pokud byla)
                material.needsUpdate = true;
                child.material = material;
            }
        });
    });
});

// Pole (array) s uloženými tetováními a proměnná pro vybrané tetování
const tattoos = [];
let selectedTattoo = null;

// Funkce pro aplikaci tetování na model
// Vytváří se tzv. DecalGeometry (dekal) — "nálepka" 
function applyTattoo(texturePath, position) {
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(texturePath, (tattooTexture) => {
        if (!currentModel) return;

        // Vytvoření materiálu pro tetování, které bude poloprůhledné,
        // ale zachová Z-buffer pro správné vykreslení před/za objekty
        const decalMaterial = new THREE.MeshPhongMaterial({
            map: tattooTexture,
            transparent: true,
            opacity: 1.0,
            depthTest: true,
            depthWrite: false,
            side: THREE.FrontSide,
        });

        // Najdeme validní (první) mesh v modelu, na který můžeme tetování "přilepit"
        let validMesh = null;
        currentModel.traverse((child) => {
            if (child.isMesh && child.geometry) {
                validMesh = child;
            }
        });

        if (!validMesh) {
            console.error('No valid geometry found in the model.');
            return;
        }

        // Vytvoření decal geometrie, která se "nalepí" na povrch daného meshe
        // position = místo, kam tetování aplikujeme
        // previewRotation = rotace (Euler) tetování
        // previewSize = velikost (box) decal geometrie
        const decalGeometry = new THREE.DecalGeometry(
            validMesh,
            position,
            previewRotation,
            previewSize
        );

        // Vytvoření meshe pro tetování, pojmenujeme ho a přidáme do scény
        const decalMesh = new THREE.Mesh(decalGeometry, decalMaterial);
        decalMesh.name = `Tattoo_${tattoos.length + 1}`;
        scene.add(decalMesh);

        // Uložíme si tetování do pole, abychom ho později mohli spravovat
        tattoos.push(decalMesh);

        // Aktualizace seznamu tetování v UI
        updateTattooList();
    });
}

// Výchozí velikost pro náhled tetování (šířka=2, výška=2, hloubka=0.5)
let previewSize = new THREE.Vector3(2, 2, 0.5);

// Funkce pro načtení seznamu tetování z API a vytvoření tlačítek (miniatur)
async function loadAndGenerateTattooButtons() {
    try {
        // Volání našeho serveru (endpointu /api/tattoos), který vrací pole názvů souborů tetování
        const tattooList = await fetch('/api/tattoos').then((res) => res.json());
        const tattooListContainer = document.getElementById('tattoo-list');
        tattooListContainer.innerHTML = ''; // Vyprázdnit seznam (aby se neskládal starý s novým)

        // Pro každý název tetování vytvoříme tlačítko s náhledem
        tattooList.forEach((tattoo) => {
            const button = document.createElement('button');
            button.classList.add('tattoo-button');
            // Nastavení pozadí tlačítka jako miniatura tetování
            button.style.backgroundImage = `url('/tattoos/${tattoo}')`;
            button.style.width = '80px';
            button.style.height = '80px';
            button.style.margin = '5px';
            button.style.backgroundSize = 'contain';
            button.style.backgroundRepeat = 'no-repeat';
            button.style.backgroundPosition = 'center';

            // Uložení cesty k tetování do atributu "data-path"
            button.setAttribute('data-path', `/tattoos/${tattoo}`);

            // Událost při kliknutí na tlačítko — nastaví vybrané tetování
            button.addEventListener('click', () => {
                selectedTattooPath = `/tattoos/${tattoo}`;
                console.log(`Selected tattoo: ${selectedTattooPath}`);
            });

            // Přidání tlačítka do kontejneru
            tattooListContainer.appendChild(button);
        });
    } catch (error) {
        console.error('Chyba při načítání tetování:', error);
    }
}

// Zavoláme funkci pro načtení tetování (a generování tlačítek) hned po spuštění
loadAndGenerateTattooButtons();

// Poslech události `click` na celý dokument
// Pokud máme vybrané tetování a klikneme na model, tak se tetování aplikuje
document.addEventListener('click', (event) => {
    if (selectedTattooPath && currentModel) {
        // Převod souřadnic myši na normalizované souřadnice pro Raycaster
        const mouse = new THREE.Vector2(
            (event.clientX / window.innerWidth) * 2 - 1,
            -(event.clientY / window.innerHeight) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        // Nastavíme Raycaster z kamery a pozice myši
        raycaster.setFromCamera(mouse, camera);

        // Zjištění průsečíků s modelem (rekurzivně na všechny children)
        const intersects = raycaster.intersectObject(currentModel, true);
        if (intersects.length > 0) {
            // První průsečík
            const point = intersects[0].point;           
            const normal = intersects[0].face.normal.clone().normalize();

            // Pozice, kam se tetování "přilepí"
            const position = new THREE.Vector3(point.x, point.y, point.z);
            // Rotace vycházející z normály plochy
            const rotation = new THREE.Euler().setFromVector3(normal);

            // Aplikujeme vybrané tetování
            applyTattoo(selectedTattooPath, position, rotation);
        }
    }
});

let previewTattoo = null; // Pomocná proměnná pro meš s náhledem tetování

// Detekce pohybu myši pro náhled tetování
document.addEventListener('mousemove', (event) => {
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    if (currentModel) {
        const intersects = raycaster.intersectObject(currentModel, true);
        if (intersects.length > 0) {
            // Získáme bod a normálu průsečíku
            const point = intersects[0].point;
            const normal = intersects[0].face.normal.clone().normalize();
            const position = new THREE.Vector3(point.x, point.y, point.z);
            const rotation = new THREE.Euler().setFromVector3(normal);

            // Zobrazíme náhled tetování
            showPreviewTattoo(position, rotation);
        } else {
            // Schová náhled, pokud myš již není nad modelem
            hidePreviewTattoo();
        }
    }
});

// Funkce pro zobrazení náhledu tetování
function showPreviewTattoo(position, rotation) {
    // Pokud nemáme zvolené tetování, neděláme nic
    if (!selectedTattooPath) return;

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(selectedTattooPath, (tattooTexture) => {
        // Pokud již existuje nějaký náhled tetování, odstraníme ho, abychom nevytvářeli kopie
        if (previewTattoo) scene.remove(previewTattoo);

        // Materiál pro náhled tetování s poloprůhledností
        const previewMaterial = new THREE.MeshPhongMaterial({
            map: tattooTexture,
            transparent: true,
            opacity: 0.5, 
            depthTest: true,
            depthWrite: false,
            side: THREE.FrontSide,
        });

        // Najdeme validní mesh v modelu
        let validMesh = null;
        currentModel.traverse((child) => {
            if (child.isMesh && child.geometry) {
                validMesh = child;
            }
        });

        if (!validMesh) {
            console.error('No valid geometry found in the model.');
            return;
        }

        // Opravení rotace tak, aby se náhled lépe zarovnal k povrchu modelu
        const correctedRotation = new THREE.Euler(
            rotation.x,
            rotation.y,
            rotation.z - 1 // Malá úprava rotace
        );

        // Vytvoření decal geometrie pro náhled tetování
        const decalGeometry = new THREE.DecalGeometry(
            validMesh,
            position,
            correctedRotation,
            previewSize
        );

        // Mesh pro náhled tetování
        previewTattoo = new THREE.Mesh(decalGeometry, previewMaterial);
        scene.add(previewTattoo);
    });
}

// Funkce pro znovuvytvoření náhledu tetování (např. po změně velikosti/rotace)
function updatePreviewTattoo() {
    if (previewTattoo) {
        // Odstraníme starý náhled
        scene.remove(previewTattoo);
        previewTattoo = null;
    }

    // Spustíme uměle event myši uprostřed obrazovky, aby se náhled znovu vytvořil
    const mouseEvent = { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
    document.dispatchEvent(new MouseEvent('mousemove', mouseEvent));
}

// Ovládání rotace náhledu tetování pomocí kláves Q (rotace vlevo) a E (rotace vpravo)
document.addEventListener('keydown', (event) => {
    switch (event.key) {
        case 'Q': 
            // Zvýšení rotace kolem osy Z (otočení doleva)
            previewRotation.z += 0.1; 
            updatePreviewTattoo();
            break;
        case 'E': 
            // Snížení rotace kolem osy Z (otočení doprava)
            previewRotation.z -= 0.1;
            updatePreviewTattoo();
            break;
    }
});

// Ovládání velikosti tetování pomocí kláves + a -
document.addEventListener('keydown', (event) => {
    switch (event.key) {
        case '+': 
            // Zvýšení velikosti
            previewSize.x += 0.1;
            previewSize.y += 0.1;
            updatePreviewTattoo();
            break;
        case '-': 
            // Snížení velikosti s omezením na min. 0.1
            previewSize.x = Math.max(0.1, previewSize.x - 0.1);
            previewSize.y = Math.max(0.1, previewSize.y - 0.1);
            updatePreviewTattoo();
            break;
    }
});

// Funkce pro schování náhledu tetování
function hidePreviewTattoo() {
    if (previewTattoo) {
        scene.remove(previewTattoo);
        previewTattoo = null;
    }
}

// Když klikneme, zatímco je aktivní náhled tetování, umístíme tetování "natrvalo"
document.addEventListener('click', (event) => {
    if (previewTattoo) {
        // Přidáme náhled tetování do pole tetování (takže ho bereme jako finalizované)
        tattoos.push(previewTattoo);
        // Reset náhledu
        previewTattoo = null; 
        // Aktualizace seznamu tetování (pokud v UI nějaký existuje)
        updateTattooList();
    }
});

// Načtení seznamu tetování z API a vygenerování příslušných tlačítek
(async function loadTattoos() {
    const tattoos = await fetch('/api/tattoos').then((res) => res.json());
    generateTattooButtons(tattoos);
})();

// Funkce animace, která se volá pořád dokola (60x za sekundu nebo podle výkonu)
// Zajišťuje překreslování scény a průběžné aktualizace
function animate() {
    requestAnimationFrame(animate);
    controls.update(); // OrbitControls update (plynulé rotace/zoom kamery)
    renderer.render(scene, camera); // Vykreslení scény
}
animate();
