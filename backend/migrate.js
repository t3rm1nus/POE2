// migrate2.js
const db = require('./src/db');
db.exec("UPDATE monitor_items SET category = 'gem' WHERE name = 'Flechas de punta helada'");
console.log('Actualizado');