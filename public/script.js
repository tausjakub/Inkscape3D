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

// Nastavení kamery - přiblížení k modelu
camera.position.set(0, 1.5, 12); // Blíže k modelu
camera.lookAt(0, 1, 0); // Pohled na střed modelu

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
        scene.remove(currentModel); // Odstranění předchozího modelu

         // Clear tattoos array and remove tattoo meshes from the scene
         tattoos.forEach(tattoo => scene.remove(tattoo));
         tattoos.length = 0; // Clear the array
         updateTattooList(); // Update the tattoo list UI
    }

    loader.load(
        modelPath,
        (gltf) => {
            currentModel = gltf.scene;

            // Traverse všechny uzly modelu a nastav bílou barvu
            currentModel.traverse((child) => {
                if (child.isMesh) {
                    const whiteMaterial = new THREE.MeshStandardMaterial({
                        color: 0xffffff, // Bílá barva
                        roughness: 0.8,
                        metalness: 0.1,
                    });
                    child.material = whiteMaterial; // Nastavení nového materiálu
                }
            });

            // Normalizace modelu na pevnou velikost
            const box = new THREE.Box3().setFromObject(currentModel);
            const size = new THREE.Vector3();
            box.getSize(size);

            const desiredHeight = 2; // Požadovaná výška modelu
            const scale = desiredHeight / size.y; // Výpočet měřítka podle výšky
            currentModel.scale.set(scale, scale, scale);

            // Rotace modelu čelem ke kameře
            currentModel.rotation.y = Math.PI; // Otočení o 180° kolem osy Y
            currentModel.rotation.x = Math.PI*0.5;
            currentModel.rotation.z = Math.PI;
            // Umístění modelu
            currentModel.position.set(0, -6, 0);

            scene.add(currentModel); // Přidání modelu do scény
        },
        undefined,
        (error) => {
            console.error('Error loading model:', error);
        }
    );
}


let previewRotation = new THREE.Euler(0, 0, 0); // Výchozí rotace náhledu tetování




console.log('Scene contents:', scene.children);
console.log('Camera position:', camera.position);
console.log('Renderer size:', renderer.getSize(new THREE.Vector2()));



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
                material.color.set(selectedColor);
                material.map = null;
                material.needsUpdate = true;
                child.material = material;
            }
        });
    });
});

// Tetování s použitím shrink-wrap decal geometrie
const tattoos = []; // Pole pro uchování všech tetování
let selectedTattoo = null;

// Funkce pro aplikaci tetování
function applyTattoo(texturePath, position, rotation) {
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(texturePath, (tattooTexture) => {
        if (!currentModel) return;

        const decalMaterial = new THREE.MeshPhongMaterial({
            map: tattooTexture,
            transparent: true,
            opacity: 1.0,
            depthTest: true,
            depthWrite: false,
            side: THREE.FrontSide,
        });

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

        const decalGeometry = new THREE.DecalGeometry(
            validMesh,
            position,
            previewRotation, // Použití aktuální rotace
            previewSize
        );

        const decalMesh = new THREE.Mesh(decalGeometry, decalMaterial);
        decalMesh.name = `Tattoo_${tattoos.length + 1}`;
        scene.add(decalMesh);
        tattoos.push(decalMesh);

        updateTattooList();
    });
}





let previewSize = new THREE.Vector3(2, 2, 0.5); // Výchozí velikost tetování



// Aktualizace seznamu tetování
// Funkce pro načítání seznamu tetování a aktualizaci tlačítek v tattoo-list
async function loadAndGenerateTattooButtons() {
    try {
        const tattooList = await fetch('/api/tattoos').then((res) => res.json());
        const tattooListContainer = document.getElementById('tattoo-list');
        tattooListContainer.innerHTML = ''; // Vyčistí seznam

        tattooList.forEach((tattoo) => {
            const button = document.createElement('button');
            button.classList.add('tattoo-button');
            button.style.backgroundImage = `url('/tattoos/${tattoo}')`;
            button.style.width = '80px';
            button.style.height = '80px';
            button.style.margin = '5px';
            button.style.backgroundSize = 'contain';
            button.style.backgroundRepeat = 'no-repeat';
            button.style.backgroundPosition = 'center';

            // Nastavení datové cesty pro tetování
            button.setAttribute('data-path', `/tattoos/${tattoo}`);

            // Akce při kliknutí na tlačítko
            button.addEventListener('click', () => {
                selectedTattooPath = `/tattoos/${tattoo}`; // Nastaví vybrané tetování
                console.log(`Selected tattoo: ${selectedTattooPath}`);
            });

            tattooListContainer.appendChild(button); // Přidá tlačítko do seznamu
        });
    } catch (error) {
        console.error('Chyba při načítání tetování:', error);
    }
}

// Zavolání funkce pro načtení a generování tetování při načtení stránky
loadAndGenerateTattooButtons();

// Funkce pro aplikaci vybraného tetování na model
document.addEventListener('click', (event) => {
    if (selectedTattooPath && currentModel) {
        const mouse = new THREE.Vector2(
            (event.clientX / window.innerWidth) * 2 - 1,
            -(event.clientY / window.innerHeight) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);

        const intersects = raycaster.intersectObject(currentModel, true);
        if (intersects.length > 0) {
            const point = intersects[0].point;
            const normal = intersects[0].face.normal.clone().normalize();
            const position = new THREE.Vector3(point.x, point.y, point.z);
            const rotation = new THREE.Euler().setFromVector3(normal);

            // Použití vybraného tetování
            applyTattoo(selectedTattooPath, position, rotation);
        }
    }
});

let previewTattoo = null; // Náhled tetování

// Detekce kliknutí na model pro náhled tetování
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
            const point = intersects[0].point;
            const normal = intersects[0].face.normal.clone().normalize();
            const position = new THREE.Vector3(point.x, point.y, point.z);
            const rotation = new THREE.Euler().setFromVector3(normal);

            // Zobrazí náhled tetování
            showPreviewTattoo(position, rotation);
        } else {
            // Skryje náhled, pokud není detekován model
            hidePreviewTattoo();
        }
    }
});


function showPreviewTattoo(position, rotation) {
    if (!selectedTattooPath) return; // Pokud není vybrané tetování, náhled se nezobrazí

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(selectedTattooPath, (tattooTexture) => {
        // Pokud již existuje náhled tetování, odstraní ho
        if (previewTattoo) scene.remove(previewTattoo);

        const previewMaterial = new THREE.MeshPhongMaterial({
            map: tattooTexture,
            transparent: true,
            opacity: 0.5, // Poloprůhledný náhled
            depthTest: true,
            depthWrite: false,
            side: THREE.FrontSide,
        });

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

        // Upravení rotace náhledu tetování
        const correctedRotation = new THREE.Euler(
            rotation.x,
            rotation.y,
            rotation.z =2*Math.PI // Posun rotace o 90° pro zarovnání
        );

        const decalGeometry = new THREE.DecalGeometry(
            validMesh,
            position,
            correctedRotation,
            previewSize
        );

        previewTattoo = new THREE.Mesh(decalGeometry, previewMaterial);
        scene.add(previewTattoo);
    });
}




function updatePreviewTattoo() {
    if (previewTattoo) {
        scene.remove(previewTattoo);
        previewTattoo = null;
    }

    // Znovu vytvoří náhled s aktualizovanou velikostí
    const mouseEvent = { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 }; // Simulace myši ve středu obrazovky
    document.dispatchEvent(new MouseEvent('mousemove', mouseEvent));
}

document.addEventListener('keydown', (event) => {
    switch (event.key) {
        case 'Q': // Rotace doleva (zvýšení rotace kolem osy Z)
            previewRotation.z += 0.1; // Rotace v radiánech
            updatePreviewTattoo();
            break;
        case 'E': // Rotace doprava (snížení rotace kolem osy Z)
            previewRotation.z -= 0.1;
            updatePreviewTattoo();
            break;
    }
});


document.addEventListener('keydown', (event) => {
    switch (event.key) {
        case '+': // Zvýšení velikosti
            previewSize.x += 0.1;
            previewSize.y += 0.1;
            updatePreviewTattoo(); // Aktualizace náhledu
            break;
        case '-': // Snížení velikosti
            previewSize.x = Math.max(0.1, previewSize.x - 0.1); // Minimální velikost 0.1
            previewSize.y = Math.max(0.1, previewSize.y - 0.1);
            updatePreviewTattoo(); // Aktualizace náhledu
            break;
    }
});



function hidePreviewTattoo() {
    if (previewTattoo) {
        scene.remove(previewTattoo);
        previewTattoo = null;
    }
}


document.addEventListener('click', (event) => {
    if (previewTattoo) {
        // Finalizace tetování (přidání do seznamu)
        tattoos.push(previewTattoo);
        previewTattoo = null; // Reset náhledu
        updateTattooList();
    }
});


// Tlačítko pro smazání vybraného tetování
const deleteButton = document.createElement('button');
deleteButton.textContent = '🗑️ Delete Tattoo';
deleteButton.id = 'delete-tattoo-button';
deleteButton.disabled = true; // Neaktivní, dokud není vybrané tetování
document.body.appendChild(deleteButton);

// Funkce pro mazání tetování
deleteButton.addEventListener('click', () => {
    if (selectedTattoo) {
        // Odebrání tetování ze scény
        scene.remove(selectedTattoo);

        // Odebrání tetování z pole
        const index = tattoos.indexOf(selectedTattoo);
        if (index > -1) {
            tattoos.splice(index, 1);
        }

        // Reset výběru
        selectedTattoo = null;
        deleteButton.disabled = true;

        // Aktualizace seznamu tetování
        updateTattooList();
    }
});

// Načtení seznamu tetování z API
(async function loadTattoos() {
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
