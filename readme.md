# 📦 PoE2 Market Watcher

> Herramienta de escritorio local (full-stack) para monitorizar el mercado de **Path of Exile 2** en español.  
> Compara tus precios, rastrea tendencias y descubre los objetos más valiosos del mercado.

---

## 🧭 Descripción general

**PoE2 Market Watcher** es una aplicación web local (frontend React + backend Node.js) que te permite:

- **Monitor de precio propio**: compara tus listings en tiempo real contra el mercado y te avisa si te están bajando el precio.
- **Historial de Precios** (antes "Mercado de Gemas"): caché automático del precio mínimo de gemas Nv.21 / 5 sockets.
- **Ranking del Mercado** (en desarrollo).

**Novedades recientes (abril 2026):**
- Select y radios en el sidebar para elegir **Realm** (PC / PlayStation) y **Liga**.
- Persistencia total del Monitor (ítems en SQLite + configuración en localStorage).
- Actualización automática del Historial al terminar cada chequeo del Monitor.
- Alertas por voz + toasts inteligentes ("El puto chinofarmer ha rebajado...").
- Polling automático configurable (5 min, 10 min, 30 min, 1 h).
- Soporte completo de realm y league en todas las llamadas a la API de GGG.

---

## 🗂️ Estructura actual del proyecto
POE2/
├── backend/
│   ├── data/                    ← poe2market.db (SQLite)
│   ├── src/
│   │   ├── routes/
│   │   │   ├── import.js
│   │   │   └── monitor.js       ← ahora recibe realm/league por query
│   │   ├── db.js
│   │   ├── gemTranslations.js
│   │   ├── index.js
│   │   ├── poeApiClient.js
│   │   ├── tracker.js
│   │   └── translations.js
│   ├── package.json
│   └── ...
├── frontend/
│   ├── src/
│   │   ├── LeagueContext.jsx    ← nuevo: realms + leagues + persistencia localStorage
│   │   ├── MonitorContext.jsx   ← nuevo: lógica completa del monitor, persistencia y auto-check
│   │   ├── pages/
│   │   │   ├── Monitor.jsx      ← monitor mejorado
│   │   │   ├── Tracker.jsx      ← Historial de Precios
│   │   │   └── Ranking.jsx      ← pendiente
│   │   ├── App.jsx              ← sidebar con select/radios
│   │   ├── App.css
│   │   └── ...
│   └── ...
├── .gitignore
├── docker-compose.yml
└── readme.md                    


---

## ✨ Características actuales

### Sidebar de configuración (nuevo)
- **Plataforma (Realm)**: select con `PC` / `PlayStation`.
- **Liga**: radios con `Standard`, `Hardcore`, `Fate of the Vaal`, `Hardcore Fate of the Vaal`.
- Todo se guarda automáticamente en `localStorage` (`poe2_realm` y `poe2_league`).
- Se muestra en el header: `Liga · REALM`.

### Monitor de Precio Propio (mejorado)
- Persistencia completa: ítems guardados en SQLite.
- Importación automática de tus listings activos (solo gemas 21/5sockets con precio en divine/chaos).
- Chequeo manual o automático (polling configurable).
- Al terminar el chequeo → **actualiza automáticamente el Historial de Precios** (tabla `gem_market_prices`).
- Alertas por voz (speechSynthesis) + toasts visuales cuando alguien te baja el precio o hay empate.
- Detección de: eres el más barato / empate / tienes otro listing tuyo más barato / hay alguien más barato.

### Historial de Precios (Tracker)
- Caché en tiempo real del precio mínimo de gemas.
- Se actualiza automáticamente cada vez que el Monitor termina un chequeo.
- Datos persistentes en la base de datos.

### Ranking del Mercado
- Módulo preparado (pantalla existe) pero todavía pendiente de implementación completa.

---

## 🔌 API de Path of Exile 2 (estado actual)

El backend ahora **inyecta dinámicamente** `realm` y `league` en todas las llamadas.  
Ejemplo de endpoint actualizado:

```http
GET /api/monitor/check?realm=pc&league=Fate%20of%20the%20Vaal
GET /api/import/listings?realm=pc&league=Standard


## 🔌 Endpoints clave (todos soportan realm/league):

POST /api/trade2/search/poe2/{league}
GET /api/trade2/fetch/...
GET /api/monitor/check
GET /api/import/listings

🗂️ Stack tecnológico

Frontend: React + Vite + Context API + localStorage + SSE
Backend: Node.js + Express + better-sqlite3 (WAL) + SSE
Base de datos: SQLite (poe2market.db)
Notificaciones: Speech Synthesis API (voz en español) + toasts

✅ Checklist de desarrollo (actualizado)
FASE 0 — Preparación ✅
FASE 1 — Backend API ✅
FASE 2 — Monitor de precio propio ✅ (totalmente mejorado)

 Soporte completo de realm y league (select/radios + persistencia)
 Persistencia del Monitor (DB + localStorage)
 Polling automático configurable
 Actualización automática del Historial al finalizar chequeo
 Alertas por voz y toasts inteligentes
 Importación + chequeo secuencial automático

FASE 3 — Historial de Precios ✅ (funcional)
FASE 4 — Ranking del Mercado 🔲 (pendiente)

🚀 Cómo usar

Clona el repo y levanta backend y frontend por separado.
Configura tu POESESSID y POE_ACCOUNT en el .env.
Abre http://localhost:5173 (frontend).
En el sidebar elige tu Realm y Liga.
En Monitor → importa tus listings → añade ítems manualmente o usa el polling.
¡Disfruta de las alertas automáticas y la actualización del historial!