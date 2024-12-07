const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Statické soubory
app.use('/models', express.static(path.join(__dirname, 'models')));
app.use('/tattoos', express.static(path.join(__dirname, 'tattoos')));
app.use(express.static(path.join(__dirname, 'public')));

// API pro získání seznamu tetování
app.get('/api/tattoos', (req, res) => {
    const tattooDir = path.join(__dirname, 'tattoos');

    fs.readdir(tattooDir, (err, files) => {
        if (err) {
            console.error('Chyba při čtení složky:', err);
            return res.status(500).send('Chyba při načítání tetování');
        }

        // Filtrovat pouze PNG soubory
        const tattoos = files.filter(file => file.endsWith('.png'));
        res.json(tattoos);
    });
});

// Spuštění serveru
app.listen(PORT, () => {
    console.log(`Server běží na http://localhost:${PORT}`);
    console.log(`Models path: ${path.join(__dirname, 'models')}`);
    console.log(`Tattoos path: ${path.join(__dirname, 'tattoos')}`);
});
console.log('Models path:', path.join(__dirname, 'models'));
console.log('Tattoos path:', path.join(__dirname, 'tattoos'));


