# 📦 PoE2 Market Watcher

> Herramienta de escritorio local (full-stack) para monitorizar el mercado de **Path of Exile 2 — Standard** en español.  
> Compara tus precios, rastrea tendencias y descubre los objetos más valiosos del mercado.

---

## 🧭 Descripción general

**PoE2 Market Watcher** es una aplicación web local (frontend + backend) compuesta por tres módulos principales:

| Módulo | Descripción | Estado |
|---|---|---|
| 🔔 **Monitor de precio propio** | Compara tu listing contra el más barato del mercado en tiempo real | ✅ Completado |
| 📈 **Historial de precios** | Registra cambios de precio de tus ítems favoritos y genera gráficas | 🔲 Pendiente |
| 🏆 **Ranking de ítems caros** | Explora los objetos más valiosos del mercado, por categoría | 🔲 Pendiente |

---

## 🔌 Investigación de la API — Estado actual

> **Resultado de la investigación:** La web de trade de GGG usa **Cloudflare** en el frontend, pero los **endpoints REST del API oficial son accesibles sin captcha** si se respetan los rate limits y se usa el `User-Agent` correcto (o se registra la app como developer).

### Endpoints clave de PoE2

```
# Buscar ítems (devuelve IDs)
POST https://www.pathofexile.com/api/trade2/search/poe2/Standard

# Obtener detalles de listings por ID (máx. 10 por petición)
GET  https://www.pathofexile.com/api/trade2/fetch/{id1,id2,...}?query={queryId}

# Datos de ítems con traducciones oficiales por idioma
GET  https://www.pathofexile.com/api/trade2/data/items

# API pública de stash tabs (stream de cambios en tiempo real)
GET  https://www.pathofexile.com/api/public-stash-tabs?id={next_change_id}

# Precios de referencia (poe.ninja — sin auth)
GET  https://poe.ninja/api/data/itemoverview?league=Standard&type={ItemType}
```

### Autenticación

- **Opción A — POESESSID (recomendada para uso personal):** Cookie de sesión obtenida al hacer login en pathofexile.com. Sin OAuth, sin registro. Válida durante la sesión activa.
- **Opción B — OAuth 2.1 (recomendada para app distribuida):** Registro de app en [pathofexile.com/developer](https://www.pathofexile.com/developer). Triplica los rate limits.
- **Rate limits:** ~12 peticiones / 60 s por IP. El backend debe hacer cola y respetar las cabeceras `X-Rate-Limit-*`.

> **Nota:** OAuth requiere solicitud manual a oauth@grindinggear.com. Para uso personal/local el POESESSID es la única opción realista a corto plazo.

### ¿Captcha / Cloudflare?

El captcha de Cloudflare **solo afecta a la web visual** (`/trade2/`). Los endpoints `/api/trade2/` son REST puro y no están protegidos por Cloudflare — solo por rate limiting. No se necesita scraping ni bypass.

---

## 🗂️ Stack tecnológico

```
frontend/     → React + Vite + CSS variables (tema oscuro)
backend/      → Node.js + Express (proxy API + BBDD)
database/     → SQLite via better-sqlite3 (WAL mode)
scheduler/    → node-cron (polling periódico)
```

---

## ✅ CHECKLIST DE DESARROLLO

### FASE 0 — Preparación y arquitectura ✅ COMPLETADA

- [X] Crear repositorio Git con estructura monorepo (`/frontend`, `/backend`, `/shared`)
- [X] Definir fichero `.env` con variables: `POESESSID`, `POLLING_INTERVAL_MS`, `DB_PATH`, `POE_ACCOUNT`
- [X] Crear `docker-compose.yml` opcional para levantar backend + BBDD en un comando
- [X] Documentar la estructura de carpetas en este README
- [X] Instalar dependencias base: `express`, `axios`, `better-sqlite3`, `node-cron`, `cors`

---

### FASE 1 — Backend: Capa de acceso a la API de GGG ✅ COMPLETADA

- [X] Crear módulo `poeApiClient.js` con cabeceras correctas (`User-Agent`, `Cookie: POESESSID=...`)
- [X] Implementar función `searchItems(query)` → POST `/api/trade2/search/poe2/Standard`
- [X] Implementar función `fetchListings(ids[], queryId)` → GET `/api/trade2/fetch/{ids}`
- [X] Implementar cola de peticiones con respeto de rate limits
- [X] Añadir reintentos con backoff exponencial ante errores 429
- [X] Implementar función `analyzePrices(query, myAccount)` — separa tus listings de los del mercado
- [X] Cache por type para no repetir llamadas al comprobar ítems duplicados

---

### FASE 2 — Módulo 1: Monitor de precio propio ✅ COMPLETADA

#### Backend
- [X] Endpoint `GET /api/monitor/check` (SSE) — comprueba precios con barra de progreso en tiempo real
- [X] Para cada ítem, búsqueda separada de tus listings vs mercado general (2 queries por type)
- [X] Comparar precio individual de cada listing vs mínimo del mercado
- [X] Detectar empates con otro vendedor al mismo precio
- [X] Detectar cuando tienes otro listing tuyo más barato activo
- [X] Endpoint `POST /api/monitor/items` — guardar ítem en BBDD
- [X] Endpoint `GET /api/monitor/items` — recuperar lista guardada
- [X] Endpoint `DELETE /api/monitor/items/:id` — eliminar ítem
- [X] Endpoint `GET /api/import/listings` (SSE) — importar tus listings activos desde la API de GGG
- [X] Filtro de importación: solo gemas nivel 21 y 5 sockets, precio en divine
- [X] Upsert por name+price: evita duplicados al reimportar
- [X] Queries guardados con `misc_filters` correctos (nivel 21, 5 sockets) y `trade_filters` (divine)

#### Frontend
- [X] Pantalla "Mi Lista de Venta" con tabla ordenable (precio, nombre)
- [X] Botón "Importar mis listings" — importa automáticamente desde la API con barra de progreso
- [X] Botón "Comprobar ahora" — SSE con barra de progreso por type único
- [X] Indicador visual por ítem: ✅ Eres el más barato / ⚡ Empate / 🔵 Tienes otro más barato / ⚠️ Hay más baratos
- [X] Botón "Borrar lista"
- [X] Persistencia en SQLite entre sesiones

---

### FASE 2B — Mejoras del Monitor ✅ COMPLETADA

#### Traducción de nombres al español
- [X] **Frontend:** Diccionario hardcodeado `gemTranslations.js` con +200 entradas extraídas de capturas in-game (PS5, versión española oficial) — cubre arco, bastón, ocultismo, primalismo, maza, ballesta, lanza, heraldos y soportes
- [X] **Frontend:** Nombres mostrados en español en la tabla; el `type` inglés se mantiene internamente para los queries a la API
- [X] **Frontend:** Tooltip al hacer hover sobre el nombre español muestra el nombre original en inglés cuando difiere
- [X] **Frontend:** Fallback silencioso al nombre inglés si el ítem no está en el diccionario

#### Polling automático
- [X] **Frontend:** Selector de intervalo en la cabecera: Desactivado / 5 min / 10 min / 30 min
- [X] **Frontend:** `setInterval` de 1 segundo que gestiona la cuenta atrás y dispara `checkPrices()` automáticamente al llegar a 0
- [X] **Frontend:** Contador regresivo visible: "⏱ Próxima: 4:32" — cambia a "⏳ Comprobando..." durante el auto-check
- [X] **Frontend:** El polling no lanza una nueva comprobación si ya hay una en curso
- [X] **Frontend:** Configuración del intervalo persistida en `localStorage`

#### Avisos sonoros
- [X] **Frontend:** Toggle 🔔/🔕 en la cabecera para activar/desactivar avisos — estado persistido en `localStorage`
- [X] **Frontend:** Síntesis de voz nativa (`Web Speech API`) en español — sin dependencias externas, selecciona automáticamente la mejor voz ES disponible en el sistema
- [X] **Frontend:** Voz completa con nombres de ítems cuando hay precios superados: *"Atención. 2 ítems con precio superado: Disparo de tornado, Campana de tempestad"*
- [X] **Frontend:** Aviso más corto para empates: *"Empate de precio detectado"*
- [X] **Frontend:** Los avisos sonoros solo se disparan en comprobaciones automáticas, nunca en manuales
- [X] **Frontend:** Botón 🔁 para **repetir el último aviso sonoro** — útil si no estabas presente cuando saltó el polling
- [X] **Frontend:** Toasts visuales en esquina inferior derecha con nombre del ítem y precio de mercado — desaparecen solos a los 5 segundos

---

### FASE 3 — Módulo 2: Historial y gráficas de precios ⬅️ SIGUIENTE

#### Backend
- [ ] Crear tabla SQLite `price_history` (`id`, `item_name`, `item_query`, `price`, `currency`, `timestamp`)
- [ ] Endpoint `POST /api/tracker/items` — añadir ítem a seguimiento con su query de búsqueda
- [ ] Endpoint `GET /api/tracker/items` — listar ítems en seguimiento
- [ ] Endpoint `DELETE /api/tracker/items/:id` — eliminar ítem del seguimiento
- [ ] Endpoint `GET /api/tracker/history/:itemId` — historial de precios de un ítem
- [ ] Job cron (`node-cron`) que ejecuta comprobación de precio cada N minutos para todos los ítems en seguimiento
- [ ] Normalización de precios: convertir divine/chaos a chaos equivalente usando poe.ninja
- [ ] Guardar snapshot de precio mínimo, mediana y precio del usuario (si aplica)

#### Frontend
- [ ] Pantalla "Seguimiento de Precios" con lista de ítems monitorizados
- [ ] Formulario para añadir ítem nuevo: nombre + configurar filtros de búsqueda (tipo, modificadores)
- [ ] Gráfica de línea (Recharts) por ítem: eje X = tiempo, eje Y = precio en chaos
- [ ] Selector de rango temporal: últimas 24h / 7 días / 30 días
- [ ] Indicador de tendencia: 📈 Subiendo / 📉 Bajando / ➡️ Estable (con % de cambio)
- [ ] Exportar historial a CSV

---

### FASE 4 — Módulo 3: Ranking de ítems más caros

#### Backend
- [ ] Integrar poe.ninja API (`/api/data/itemoverview`) — sin autenticación necesaria
- [ ] Endpoint `GET /api/ranking?type=UniqueWeapon` — devuelve top N ítems más caros del tipo
- [ ] Tipos soportados: `UniqueWeapon`, `UniqueArmour`, `UniqueAccessory`, `UniqueFlask`, `Currency`, `Fragment`, `Skill` (gemas), `DivinationCard`
- [ ] Cachear respuesta de poe.ninja durante 1 hora para no saturar
- [ ] Normalizar precios a chaos equivalente para ordenación uniforme

#### Frontend
- [ ] Pantalla "Mercado" con selector desplegable de categoría (en español)
- [ ] Tabla de los top 50 ítems más caros: nombre, precio, variación 24h, icono
- [ ] Buscador/filtro dentro de la tabla
- [ ] Botón "Ver en Trade" — abre link directo al trade de ese ítem
- [ ] Actualización automática al cambiar categoría

---

### FASE 5 — UX / UI

- [X] Layout general: sidebar izquierdo con los 3 módulos, contenido principal a la derecha
- [X] Tema oscuro por defecto (coherente con la estética de PoE2)
- [X] Todos los textos y etiquetas en español
- [X] Nombres de ítems en español con tooltip al hover (ver Fase 2B)
- [X] Toast de notificaciones de precio con auto-dismiss a los 5 segundos
- [X] Loading states y barras de progreso visibles al usuario
- [ ] Favicon e icono de app personalizado

---

### FASE 6 — Calidad y despliegue local

- [ ] Variables de entorno documentadas en `.env.example`
- [ ] Script `npm run dev` que levanta frontend + backend simultáneamente
- [ ] Script `npm run build` para empaquetar como app Electron standalone
- [ ] Logs del backend en fichero para debug
- [ ] Gestión de errores de sesión expirada: aviso al usuario para renovar POESESSID

---

## 🚀 Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/poe2-market-watcher
cd poe2-market-watcher

# 2. Instalar dependencias del backend
cd backend
npm install

# 3. Configurar variables de entorno
# Crear archivo .env en la raíz del proyecto (C:\proyectos\POE2\.env)
POESESSID=tu_session_id_aqui
POE_ACCOUNT=tu_nombre_de_cuenta#1234
DB_PATH=./data/poe2market.db

# 4. Arrancar backend (desde /backend)
npm run dev

# 5. Arrancar frontend (desde /frontend, en otra terminal)
npm run dev
```

### ¿Cómo obtengo mi POESESSID?

1. Ve a [pathofexile.com](https://www.pathofexile.com) e inicia sesión
2. Abre DevTools → Application → Cookies → `www.pathofexile.com`
3. Copia el valor de la cookie `POESESSID`
4. Pégalo en tu archivo `.env`

### ¿Dónde está la base de datos?

La BD SQLite se guarda en `C:\proyectos\POE2\backend\data\poe2market.db`. El `DB_PATH` en `.env` es relativo a la carpeta desde donde se ejecuta el backend (`/backend`), por lo que debe ser `./data/poe2market.db`.

---

## ⚠️ Avisos importantes

- Esta herramienta es **solo para uso personal** y respeta los [términos de la API de GGG](https://www.pathofexile.com/developer/docs)
- No automatiza pulsaciones de teclas ni interacciones con el juego
- Respeta los rate limits — la cola de peticiones tiene un delay de 5s entre llamadas (~12 req/60s)
- Cada comprobación completa tarda varios minutos dependiendo del número de ítems únicos en la lista
- El `POESESSID` es equivalente a tu contraseña: **nunca lo compartas**

---

## 📄 Licencia

MIT © 2025 — Proyecto personal, no afiliado con Grinding Gear Games