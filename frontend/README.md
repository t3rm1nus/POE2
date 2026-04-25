# 📦 PoE2 Market Watcher

> Herramienta de escritorio local (full-stack) para monitorizar el mercado de **Path of Exile 2** en español.
> Compara tus precios, rastrea tendencias y descubre los objetos más valiosos del mercado.

---

## 🧭 Descripción general

**PoE2 Market Watcher** es una aplicación web local (React + Node.js/Express + SQLite) que te permite:

- **Monitor de precio propio**: importa tus listings activos desde la API de GGG, los guarda en SQLite y los compara en tiempo real contra el mercado. Te avisa por voz y toast si alguien te baja el precio, si hay empate, o si has vendido algo.
- **Historial de Precios**: caché automático del precio mínimo de gemas Nv.21 / 5 sockets, actualizado tras cada chequeo del Monitor.
- **Ranking del Mercado**: módulo preparado, pendiente de implementación.

---

## 🗂️ Estructura del proyecto
POE2/
├── backend/
│   ├── data/                    ← poe2market.db (SQLite, generado automáticamente)
│   └── src/
│       ├── routes/
│       │   ├── import.js        ← importa listings activos del usuario vía SSE
│       │   ├── monitor.js       ← CRUD de ítems + check de precios vía SSE
│       │   └── tracker.js       ← historial de precios de gemas vía SSE
│       ├── db.js                ← inicialización SQLite + migraciones automáticas
│       ├── gemTranslations.js   ← mapa EN→ES de nombres de gemas
│       ├── index.js             ← entry point Express
│       ├── poeApiClient.js      ← wrapper de la API trade2 de GGG
│       ├── tracker.js           ← lista maestra de gemas + rutas /api/tracker
│       └── translations.js
├── frontend/
│   └── src/
│       ├── LeagueContext.jsx    ← realm (PC/PlayStation) + liga + persistencia localStorage
│       ├── MonitorContext.jsx   ← estado global del monitor, polling y alertas
│       ├── monitorUtils.js      ← POLL_OPTIONS, formatCountdown, speechSynthesis helpers
│       ├── gemTranslations.js   ← mapa EN→ES (frontend)
│       └── pages/
│           ├── Monitor.jsx      ← página principal del monitor
│           ├── Tracker.jsx      ← historial de precios
│           └── Ranking.jsx      ← pendiente

---

## ✨ Características

### Sidebar de configuración
- **Plataforma (Realm)**: PC o PlayStation (`pc` / `sony` en la API de GGG).
- **Liga**: Standard, Hardcore, Fate of the Vaal, Hardcore Fate of the Vaal.
- Persiste en `localStorage` (`poe2_realm`, `poe2_league`).
- Se muestra en el header: `Liga · REALM`.

### Monitor de Precio Propio
- **Importación** (`/api/import/listings`): busca todos tus listings activos de gemas Nv.21/5s con precio en divine, los descarga en chunks de 10 con delay de 8 s entre chunks (respeto al rate limit de GGG), borra la tabla y la repopula desde cero. Durante la importación también actualiza el caché del Historial si tu precio es ≤ al que había.
- **Chequeo** (`/api/monitor/check`): para cada ítem llama a `analyzePrices`, detecta si eres el más barato, hay empate, alguien te ha bajado o ya no tienes listing activo (vendido). Deduplica ítems con el mismo `type` y limpia huérfanos. Actualiza `gem_market_prices` al terminar.
- **Auto-check (polling)**: opciones de 5 min, 10 min, 30 min, 1 h, 3 h. En el ciclo automático: limpia la lista → importa → detecta ventas pre-check comparando snapshot anterior vs estado fresco → lanza el chequeo pasando las ventas pre-detectadas.
- **Detección de ventas**:
  - *Venta completa por check*: `noActiveListings` (el ítem ya no aparece en el mercado).
  - *Venta completa pre-check*: el ítem estaba en el snapshot pero no volvió tras el import.
  - *Venta parcial por check*: `storedQuantity > myListingsCount > 0`.
  - *Venta parcial pre-check*: `prevQty > currentQty` tras el import.
- **Alertas**: voz en español (`speechSynthesis`) + toasts visuales de 5 s. El orden de locución es: estado de precios → ventas completas → ventas parciales. Botón para repetir el último aviso.
- **Persistencia**: ítems en SQLite (`monitor_items`), intervalo de polling y preferencia de sonido en `localStorage`.
- **Ordenación** de la tabla: por precio desc/asc o nombre.
- **Agrupación** de filas con `rowSpan` cuando hay varias entradas del mismo ítem.

### Historial de Precios (Tracker)
- Lista maestra de ~180 gemas organizadas por categoría (Arco, Bastón, Ocultismo, Primalismo, Maza, Ballesta, Lanza, Soporte).
- Escaneo SSE (`/api/tracker/scan`): busca el precio mínimo de cada gema (Nv.21, 5s, precio en divine) y lo guarda en `gem_market_prices`. Saltea las que tienen caché de < 24 h salvo `force=true`.
- El Monitor actualiza automáticamente el Historial tras cada chequeo y tras cada importación.
- Endpoint de borrado por realm/league o global.

### Base de datos (SQLite, WAL)
- `monitor_items`: id, name, category, query (JSON), my_price, currency, quantity, created_at.
- `gem_market_prices`: PK compuesta `(gem_type, realm, league)`, cheapest_price, currency, seller, seller_online, indexed, total_listings, fetched_at.
- Migraciones automáticas al arrancar: añade `quantity` si falta, recrea la tabla con PK compuesta si era simple.

---

## 🔌 API de GGG utilizada

Todos los endpoints inyectan `realm` y `league` dinámicamente:
POST /api/trade2/search/poe2/{league}          ← búsqueda
GET  /api/trade2/fetch/{ids}?query={id}        ← fetch de listings
GET  /api/monitor/items                         ← listar ítems
POST /api/monitor/items                         ← añadir ítem
DELETE /api/monitor/items/:id                   ← borrar ítem
GET  /api/monitor/check?realm=&league=          ← chequeo SSE
GET  /api/import/listings?realm=&league=        ← importar SSE
GET  /api/tracker/gems?realm=&league=           ← leer historial
GET  /api/tracker/scan?realm=&league=&force=    ← escanear SSE
DELETE /api/tracker/gems?realm=&league=         ← borrar historial


---

## 🗂️ Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React + Vite + Context API |
| Comunicación | Server-Sent Events (SSE) |
| Backend | Node.js + Express |
| Base de datos | SQLite vía `better-sqlite3` (WAL) |
| Notificaciones | Web Speech API + toasts inline |
| Persistencia config | `localStorage` |

---

## ⚙️ Variables de entorno

```env
POESESSID=tu_session_id_de_pathofexile
POE_ACCOUNT=tu_nombre_de_cuenta
DB_PATH=./data/poe2market.db   # opcional
```

---

## 🚀 Cómo usar

1. Clona el repo. Levanta backend (`node src/index.js`) y frontend (`vite`) por separado o con Docker Compose.
2. Configura `POESESSID` y `POE_ACCOUNT` en el `.env` del backend.
3. Abre `http://localhost:5173`.
4. Elige **Realm** y **Liga** en el sidebar.
5. En **Monitor** → pulsa *Importar mis listings* → se pobla la lista automáticamente.
6. Activa el **Auto-check** con el intervalo que prefieras.
7. Las alertas de voz y toasts te avisarán de bajadas de precio y ventas.

---

## ✅ Estado del desarrollo

| Fase | Estado |
|---|---|
| FASE 0 — Preparación | ✅ |
| FASE 1 — Backend API | ✅ |
| FASE 2 — Monitor de precio propio | ✅ |
| FASE 3 — Historial de Precios | ✅ |
| FASE 4 — Ranking del Mercado | 🔲 pendiente |