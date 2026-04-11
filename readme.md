# 📦 PoE2 Market Watcher

> Herramienta de escritorio local (full-stack) para monitorizar el mercado de **Path of Exile 2 — Standard** en español.  
> Compara tus precios, rastrea tendencias y descubre los objetos más valiosos del mercado.

---

## 🧭 Descripción general

**PoE2 Market Watcher** es una aplicación web local (frontend + backend) compuesta por tres módulos principales:

| Módulo | Descripción |
|---|---|
| 🔔 **Monitor de precio propio** | Compara tu listing contra el más barato del mercado en tiempo real |
| 📈 **Historial de precios** | Registra cambios de precio de tus ítems favoritos y genera gráficas |
| 🏆 **Ranking de ítems caros** | Explora los objetos más valiosos del mercado, por categoría |

---

## 🔌 Investigación de la API — Estado actual

> **Resultado de la investigación:** La web de trade de GGG usa **Cloudflare** en el frontend, pero los **endpoints REST del API oficial son accesibles sin captcha** si se respetan los rate limits y se usa el `User-Agent` correcto (o se registra la app como developer).

### Endpoints clave de PoE2

```
# Buscar ítems (devuelve IDs)
POST https://www.pathofexile.com/api/trade2/search/poe2/Standard

# Obtener detalles de listings por ID (máx. 10 por petición)
GET  https://www.pathofexile.com/api/trade2/fetch/{id1,id2,...}?query={queryId}

# API pública de stash tabs (stream de cambios en tiempo real)
GET  https://www.pathofexile.com/api/public-stash-tabs?id={next_change_id}

# Precios de referencia (poe.ninja — sin auth)
GET  https://poe.ninja/api/data/itemoverview?league=Standard&type={ItemType}
```

### Autenticación

- **Opción A — POESESSID (recomendada para uso personal):** Cookie de sesión obtenida al hacer login en pathofexile.com. Sin OAuth, sin registro. Válida durante la sesión activa.
- **Opción B — OAuth 2.1 (recomendada para app distribuida):** Registro de app en [pathofexile.com/developer](https://www.pathofexile.com/developer). Triplica los rate limits.
- **Rate limits:** ~12 peticiones / 60 s por IP. El backend debe hacer cola y respetar las cabeceras `X-Rate-Limit-*`.

### ¿Captcha / Cloudflare?

El captcha de Cloudflare **solo afecta a la web visual** (`/trade2/`). Los endpoints `/api/trade2/` son REST puro y no están protegidos por Cloudflare — solo por rate limiting. No se necesita scraping ni bypass.

---

## 🗂️ Stack tecnológico sugerido

```
frontend/     → Electron + React + Tailwind + Recharts (app desktop local)
backend/      → Node.js + Express (proxy API + BBDD)
database/     → SQLite (historial de precios, lista de ítems)
scheduler/    → node-cron (polling periódico)
```

---

## ✅ CHECKLIST DE DESARROLLO COMPLETO

### FASE 0 — Preparación y arquitectura

- [ ] Crear repositorio Git con estructura monorepo (`/frontend`, `/backend`, `/shared`)
- [ ] Definir fichero `.env` con variables: `POESESSID`, `POLLING_INTERVAL_MS`, `DB_PATH`
- [ ] Crear `docker-compose.yml` opcional para levantar backend + BBDD en un comando
- [ ] Documentar la estructura de carpetas en este README
- [ ] Instalar dependencias base: `express`, `axios`, `better-sqlite3`, `node-cron`, `cors`

---

### FASE 1 — Backend: Capa de acceso a la API de GGG

- [ ] Crear módulo `poeApiClient.js` con cabeceras correctas (`User-Agent`, `Cookie: POESESSID=...`)
- [ ] Implementar función `searchItems(query)` → POST `/api/trade2/search/poe2/Standard`
- [ ] Implementar función `fetchListings(ids[], queryId)` → GET `/api/trade2/fetch/{ids}`
- [ ] Implementar cola de peticiones con respeto de rate limits (cabeceras `X-Rate-Limit-Policy`)
- [ ] Añadir reintentos con backoff exponencial ante errores 429
- [ ] Crear endpoint backend `GET /api/cheapest?itemQuery=...` que devuelva el listing más barato
- [ ] Validar y parsear respuesta: precio, vendedor, divisa, fecha de listing
- [ ] Tests unitarios del cliente API con datos mockeados

---

### FASE 2 — Módulo 1: Monitor de precio propio

#### Backend
- [ ] Endpoint `POST /api/monitor/check` — recibe lista de ítems del usuario con su precio
- [ ] Para cada ítem, consultar el más barato del mercado vía `poeApiClient`
- [ ] Comparar precio del usuario vs precio mínimo del mercado
- [ ] Devolver resultado: `{ item, myPrice, marketMin, isMinPrice: bool, cheaper: [] }`
- [ ] Endpoint `POST /api/monitor/items` — guardar lista de ítems del usuario en BBDD
- [ ] Endpoint `GET /api/monitor/items` — recuperar lista guardada

#### Frontend
- [ ] Pantalla "Mi Lista de Venta" con tabla editable (nombre ítem, precio, divisa)
- [ ] Botón "Importar desde Trade URL" — parsear URL tipo `.../4mvwJ57ET9` y autorellenar
- [ ] Botón "Comprobar ahora" — llama a `/api/monitor/check` y muestra resultado
- [ ] Indicador visual por ítem: ✅ Eres el más barato / ⚠️ Han surgido ofertas más baratas
- [ ] Mostrar listado de ofertas más baratas detectadas (vendedor, precio, enlace directo)
- [ ] Polling automático configurable (ej: cada 5 minutos) con notificación visual/sonora
- [ ] Persistencia local de la lista entre sesiones

---

### FASE 3 — Módulo 2: Historial y gráficas de precios

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

- [ ] Layout general: sidebar izquierdo con los 3 módulos, contenido principal a la derecha
- [ ] Tema oscuro por defecto (coherente con la estética de PoE2)
- [ ] Todos los textos y etiquetas en español
- [ ] Nombres de ítems mostrados en su versión en español (usar campo `name` de la API ES)
- [ ] Toast de notificaciones: alertas de precio, errores de API, confirmaciones
- [ ] Loading states y manejo de errores visibles al usuario
- [ ] Favicon e icono de app personalizado

---

### FASE 6 — Calidad y despliegue local

- [ ] Variables de entorno documentadas en `.env.example`
- [ ] Script `npm run dev` que levanta frontend + backend simultáneamente
- [ ] Script `npm run build` para empaquetar como app Electron standalone
- [ ] Logs del backend en fichero para debug
- [ ] README con instrucciones de instalación paso a paso (esta sección 👇)
- [ ] Gestión de errores de sesión expirada: aviso al usuario para renovar POESESSID

---

## 🚀 Instalación (borrador)

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/poe2-market-watcher
cd poe2-market-watcher

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# → Editar .env y añadir tu POESESSID

# 4. Arrancar en modo desarrollo
npm run dev
```

### ¿Cómo obtengo mi POESESSID?

1. Ve a [pathofexile.com](https://www.pathofexile.com) e inicia sesión
2. Abre DevTools → Application → Cookies → `www.pathofexile.com`
3. Copia el valor de la cookie `POESESSID`
4. Pégalo en tu archivo `.env`

---

## ⚠️ Avisos importantes

- Esta herramienta es **solo para uso personal** y respeta los [términos de la API de GGG](https://www.pathofexile.com/developer/docs)
- No automatiza pulsaciones de teclas ni interacciones con el juego
- Respeta los rate limits — no configures intervalos de polling inferiores a 30 segundos
- El `POESESSID` es equivalente a tu contraseña: **nunca lo compartas**

---

## 📄 Licencia

MIT © 2025 — Proyecto personal, no afiliado con Grinding Gear Games