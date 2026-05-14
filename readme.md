# 📦 PoE2 Market Watcher

> Herramienta de escritorio local (full-stack) para monitorizar el mercado de **Path of Exile 2** en español.  
> Compara tus precios, rastrea tendencias y descubre los objetos más valiosos del mercado.

---

## 🧭 Descripción general

**PoE2 Market Watcher** es una aplicación web local (frontend React + backend Node.js) que te permite:

- **Monitor de precio propio**: compara tus listings en tiempo real contra el mercado y te avisa si te están bajando el precio.
- **Historial de Precios**: caché automático del precio mínimo de gemas Nv.21 / 5 sockets.
- **ChInOfArMeRs**: monitoriza si tus competidores están conectados en tiempo real.
- **Stock de vendedores**: escanea y visualiza todas las gemas Nv.21 / 5 sockets que tiene en venta un vendedor concreto.
- **Dinerete**: registro automático y persistente de todas las ventas detectadas con totales de ingresos.
- **Ranking del Mercado**: top 100 de ítems más valiosos vía poe2scout.com.

**Novedades recientes (abril 2026):**
- Select y radios en el sidebar para elegir **Realm** (PC / PlayStation) y **Liga**.
- Persistencia total del Monitor (ítems en SQLite + configuración en localStorage).
- Actualización automática del Historial al terminar cada chequeo del Monitor.
- Alertas por voz + toasts inteligentes ("El puto chinofarmer ha rebajado...").
- Polling automático configurable.
- Soporte completo de realm y league en todas las llamadas a la API de GGG.
- **Nuevo:** módulo ChInOfArMeRs con poller de estado online y SSE en tiempo real.
- **Nuevo:** escaneo de stock de gemas por vendedor con barra de progreso y persistencia.
- **Nuevo:** página Dinerete — registro automático de ventas con histórico persistente en SQLite.
- **Nuevo:** endpoint `/api/translations` para consultar y refrescar el mapa de traducciones en caliente.
- **Nuevo:** Ranking del Mercado operativo con datos de poe2scout.com, filtros, ordenación y caché de 5 min.

---

## 🗂️ Estructura actual del proyecto

```
POE2/
├── backend/
│   ├── data/                      ← poe2market.db (SQLite)
│   ├── src/
│   │   ├── routes/
│   │   │   ├── import.js          ← importación de listings propios (SSE)
│   │   │   ├── monitor.js         ← CRUD de ítems + chequeo de precios (SSE)
│   │   │   ├── chinofarmers.js    ← estado online + stocks de vendedores
│   │   │   ├── sales.js           ← registro de ventas (Dinerete)
│   │   │   ├── ranking.js         ← top100 poe2scout + historial de snapshots
│   │   │   └── translations.js    ← consulta y refresco del mapa de traducciones
│   │   ├── db.js
│   │   ├── gemTranslations.js
│   │   ├── index.js
│   │   ├── poeApiClient.js
│   │   ├── tracker.js             ← lógica de escaneo masivo de gemas (SSE) + lista GEMS
│   │   └── translations.js
│   ├── package.json
│   └── ...
├── frontend/
│   ├── src/
│   │   ├── LeagueContext.jsx      ← realms + leagues + persistencia localStorage
│   │   ├── MonitorContext.jsx     ← lógica completa del monitor, persistencia y auto-check
│   │   ├── TrackerContext.jsx     ← estado del escaneo masivo, compartido entre páginas
│   │   ├── ChinofarmersContext.jsx
│   │   ├── pages/
│   │   │   ├── Monitor.jsx        ← monitor mejorado
│   │   │   ├── Tracker.jsx        ← Historial de Precios
│   │   │   ├── Chinofarmers.jsx   ← lista y estado online de vendedores
│   │   │   ├── Stocks.jsx         ← stock de gemas de un vendedor
│   │   │   ├── Dinerete.jsx       ← registro y seguimiento de ventas
│   │   │   └── Ranking.jsx        ← top 100 del mercado vía poe2scout
│   │   ├── App.jsx                ← sidebar con select/radios
│   │   ├── App.css
│   │   └── ...
│   └── ...
├── .gitignore
├── docker-compose.yml
└── readme.md
```

---

## ✨ Características actuales

### Sidebar de configuración
- **Plataforma (Realm)**: select con `PC` / `PlayStation`.
- **Liga**: radios con `Standard`, `Hardcore`, `Fate of the Vaal`, `Hardcore Fate of the Vaal`.
- Todo se guarda automáticamente en `localStorage` (`poe2_realm` y `poe2_league`).
- Se muestra en el header: `Liga · REALM`.

### Monitor de Precio Propio 🔔
- Persistencia completa: ítems guardados en SQLite.
- Importación automática de tus listings activos (solo gemas 21/5sockets con precio en divine/annulment).
- Chequeo manual o automático (polling configurable).
- Al terminar el chequeo → actualiza automáticamente el Historial de Precios.
- Al detectar ventas (listing desaparecido o cantidad reducida) → las registra automáticamente en Dinerete.
- Alertas por voz (speechSynthesis) + toasts visuales cuando alguien te baja el precio o hay empate.
- Detección de: eres el más barato / empate / tienes otro listing tuyo más barato / hay alguien más barato.
- Deduplicación automática de ítems duplicados por `gem_type` al iniciar el chequeo.
- Auto-sincronización del precio en DB cuando se detecta un listing propio más barato.
- Soporte de divisa `annulment` (2 ann = 1 divine) además de `divine`.

### Historial de Precios (Tracker) 📈
- Escaneo masivo de todas las gemas Nv.21 / 5 sockets del juego.
- Caché en tiempo real del precio mínimo por gema, con antigüedad y estado del vendedor.
- Escaneo incremental (solo las obsoletas o pendientes) o forzado completo.
- Se actualiza automáticamente cada vez que el Monitor termina un chequeo.
- Datos persistentes en SQLite; el estado del escaneo se mantiene al navegar entre páginas (TrackerContext).
- Filtros por categoría (Arco, Bastón, Ocultismo, Primalismo, Maza, Ballesta, Lanza, Elemental, Heraldo, Soporte), búsqueda por nombre, ordenación y opción de ocultar gemas sin precio o de soporte.
- Indicador de vendedor con estado online/offline/desconocido y equivalencia en divine para precios en annulment.

### ChInOfArMeRs 👲
- Añade cuentas de vendedores rivales a una lista de vigilancia.
- **Poller automático** configurable (2, 5, 30 o 60 minutos) que comprueba si cada cuenta tiene listings activos con estado `online`.
- **SSE en tiempo real**: la UI se actualiza al instante sin necesidad de refrescar.
- **Alerta por voz** cuando un chinofarmer se desconecta (speechSynthesis en español).
- Toggle por usuario para activar/desactivar el seguimiento individualmente.
- Indicador visual (luz verde pulsante / gris) para saber quién está conectado de un vistazo.
- Stats rápidas: total de cuentas, activas y online en este momento.
- Botón **📦 Stock** por usuario para saltar directamente al escaneo de su inventario.
- Botón 🔇/🔊 para silenciar las alertas de voz globalmente.

### Stock de vendedores 📦
- Muestra todas las gemas **Nv.21 / 5 sockets** que tiene en venta un vendedor concreto.
- **Escaneo automático** al abrir la vista por primera vez; si ya hay datos previos los muestra de inmediato.
- **Barra de progreso en tiempo real** (SSE) con chunks de fetch.
- Agrupación por tipo de gema con precio mínimo, máximo y todos los listings ordenados.
- Conversión a divine configurable (input de tasa divine/chaos persistido en localStorage).
- Nombres de gema en español con el nombre original en inglés al hacer hover.
- Persistencia en SQLite por combinación `username + realm + league`.
- Botones para forzar nuevo escaneo o borrar los datos almacenados.

### Dinerete 💰
- Registra automáticamente cada venta detectada por el Monitor (listing desaparecido o cantidad reducida entre chequeos).
- Distingue entre **venta total** (el listing desapareció completamente) y **venta parcial** (bajó la cantidad).
- Tabla persistente en SQLite con: fecha, nombre de la gema en español, cantidad vendida, precio unitario y total.
- **Stats en tiempo real**: ventas registradas, gemas vendidas totales, divine y chaos ingresados.
- Botón ✕ por fila para eliminar una entrada cuando hayas repuesto la gema.
- Se actualiza al instante vía evento `dinerete:sale-added` sin necesidad de recargar la página.
- Hover sobre el nombre de la gema muestra el nombre original en inglés.

### Ranking del Mercado 🏆
- Top 100 de ítems más valiosos del mercado, datos de **poe2scout.com**.
- Categorías: únicos (arma, armadura, accesorio, frasco, joya) + divisas.
- Filtro por categoría, búsqueda por nombre y ordenación por precio divine, precio chaos, variación 24h o número de listings.
- Variación 24h calculada a partir de los `PriceLogs` de la API de poe2scout.
- Icono del ítem, nivel/calidad de gema, links y estado de corrupción.
- **Caché en memoria de 5 minutos** por combinación liga+realm para no saturar poe2scout.
- Snapshot de precios guardados en SQLite (`ranking_snapshots`) para calcular tendencias históricas.

---

## 🔌 API de Path of Exile 2 (estado actual)

El backend inyecta dinámicamente `realm` y `league` en todas las llamadas.

```http
GET  /api/monitor/check?realm=pc&league=Fate%20of%20the%20Vaal
GET  /api/import/listings?realm=pc&league=Standard
```

### Endpoints clave

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/trade2/search/poe2/{league}` | Búsqueda de listings |
| `GET`  | `/api/trade2/fetch/...` | Obtener listings por IDs |
| `GET`  | `/api/monitor/items` | Listar ítems del monitor |
| `POST` | `/api/monitor/items` | Añadir ítem al monitor |
| `DELETE` | `/api/monitor/items/:id` | Eliminar ítem del monitor |
| `GET`  | `/api/monitor/check` | Chequeo del monitor (SSE) |
| `GET`  | `/api/import/listings` | Importar listings propios (SSE) |
| `GET`  | `/api/tracker/gems` | Listar gemas en caché |
| `GET`  | `/api/tracker/scan` | Escaneo masivo de gemas (SSE) |
| `DELETE` | `/api/tracker/gems` | Borrar caché de gemas |
| `GET`  | `/api/chinofarmers` | Listar vendedores monitorizados |
| `POST` | `/api/chinofarmers` | Añadir vendedor |
| `DELETE` | `/api/chinofarmers/:id` | Eliminar vendedor |
| `PATCH` | `/api/chinofarmers/:id/active` | Activar/desactivar seguimiento |
| `POST` | `/api/chinofarmers/interval` | Configurar intervalo del poller |
| `GET`  | `/api/chinofarmers/events` | SSE de estado online (tiempo real) |
| `GET`  | `/api/chinofarmers/:username/stocks` | Stocks guardados de un vendedor |
| `POST` | `/api/chinofarmers/:username/stocks/scan` | Disparar escaneo de stock |
| `DELETE` | `/api/chinofarmers/:username/stocks` | Borrar stocks de un vendedor |
| `GET`  | `/api/chinofarmers/:username/stocks/events` | SSE de progreso del escaneo |
| `GET`  | `/api/sales` | Listar todas las ventas (Dinerete) |
| `POST` | `/api/sales` | Registrar una venta |
| `DELETE` | `/api/sales/:id` | Eliminar una venta |
| `GET`  | `/api/ranking/gems` | Escaneo de ranking por gemas (SSE) |
| `GET`  | `/api/ranking/history/:gemType` | Historial de precios de una gema |
| `GET`  | `/api/ranking/top100` | Top 100 ítems vía poe2scout.com |
| `GET`  | `/api/translations` | Mapa completo de traducciones EN→ES |
| `POST` | `/api/translations/refresh` | Forzar recarga de la caché de traducciones |

---

## 🗂️ Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Frontend | React + Vite + Context API + localStorage + SSE |
| Backend | Node.js + Express + better-sqlite3 (WAL) + SSE |
| HTTP client | axios (llamadas a la API de GGG) |
| Base de datos | SQLite (`poe2market.db`) |
| Datos externos | poe2scout.com (Ranking top 100) |
| Notificaciones | Speech Synthesis API (voz en español) + toasts |

### Tablas SQLite

| Tabla | Descripción |
|-------|-------------|
| `monitor_items` | Ítems del monitor de precio propio |
| `gem_market_prices` | Caché del historial de precios de gemas |
| `chinofarmers` | Cuentas de vendedores monitorizados |
| `chinofarmer_stocks` | Stocks de gemas escaneados por vendedor |
| `sales` | Registro persistente de ventas detectadas (Dinerete) |
| `ranking_snapshots` | Snapshots de precios para calcular tendencias del Ranking |

---

## ✅ Checklist de desarrollo (actualizado)

- **FASE 0** — Preparación ✅
- **FASE 1** — Backend API ✅
- **FASE 2** — Monitor de precio propio ✅
  - [x] Soporte completo de realm y league
  - [x] Persistencia del Monitor (DB + localStorage)
  - [x] Polling automático configurable
  - [x] Actualización automática del Historial al finalizar chequeo
  - [x] Alertas por voz y toasts inteligentes
  - [x] Importación + chequeo secuencial automático
  - [x] Detección y registro automático de ventas → Dinerete
  - [x] Soporte de divisa annulment (2 ann = 1 divine)
  - [x] Deduplicación y auto-sincronización de precios en DB
- **FASE 3** — Historial de Precios ✅
  - [x] Escaneo masivo incremental y forzado
  - [x] Filtros por categoría (incluida Elemental), búsqueda y ordenación
  - [x] Estado del escaneo persistente al navegar (TrackerContext)
  - [x] Indicador de vendedor con estado online y equivalencia en divine
- **FASE 4** — ChInOfArMeRs ✅
  - [x] Poller de estado online con SSE
  - [x] Alerta por voz al desconectarse
  - [x] Toggle activo/inactivo por usuario
  - [x] Intervalo configurable desde la UI
  - [x] Botón de silencio global
- **FASE 5** — Stock de vendedores ✅
  - [x] Escaneo de gemas Nv.21 / 5 sockets por cuenta
  - [x] Progreso en tiempo real vía SSE
  - [x] Persistencia por realm + league
  - [x] Nombres en español con hover en inglés
  - [x] Conversión a divine con tasa configurable
- **FASE 6** — Dinerete ✅
  - [x] Registro automático de ventas totales y parciales
  - [x] Tabla persistente en SQLite
  - [x] Stats de ingresos por divisa
  - [x] Borrado individual de entradas
  - [x] Actualización en tiempo real vía evento del Monitor
- **FASE 7** — Ranking del Mercado ✅ *(operativo)*
  - [x] Top 100 ítems vía poe2scout.com
  - [x] Filtros por categoría, búsqueda y ordenación
  - [x] Variación de precio 24h
  - [x] Caché en memoria de 5 min por liga+realm
  - [x] Snapshots en SQLite para tendencias históricas
- **FASE 8** — Traducciones ✅
  - [x] Endpoint `/api/translations` para consulta y refresco en caliente

---

## 🚀 Cómo usar

1. Clona el repo y levanta backend y frontend por separado.
2. Configura tu `POESESSID` y `POE_ACCOUNT` en el `.env`.
3. Abre `http://localhost:5173` (frontend).
4. En el sidebar elige tu **Realm** y **Liga**.
5. En **Monitor** → importa tus listings → añade ítems manualmente o usa el polling.
6. En **ChInOfArMeRs** → añade cuentas rivales → configura el intervalo y activa el seguimiento.
7. Pulsa **📦 Stock** en cualquier chinofarmer para ver todas sus gemas en venta.
8. En **Dinerete** → consulta tu historial de ventas y borra entradas cuando repongas stock.
9. En **Ranking** → pulsa Actualizar para ver el top 100 del mercado con datos de poe2scout.
10. ¡Disfruta de las alertas automáticas, el historial y el espionaje industrial!