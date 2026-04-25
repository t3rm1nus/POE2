require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const monitorRoutes      = require('./routes/monitor');
app.use('/api/monitor', monitorRoutes);

const importRoutes       = require('./routes/import');
app.use('/api/import', importRoutes);

const translationsRouter = require('./routes/translations');
app.use('/api/translations', translationsRouter);

const trackerRouter      = require('./tracker');
app.use('/api/tracker', trackerRouter);

const rankingRouter      = require('./routes/ranking');
app.use('/api/ranking', rankingRouter);

// ── ChInOfArMeRs ────────────────────────────────────────────────────────────
const chinofarmersRouter = require('./routes/chinofarmers');
app.use('/api/chinofarmers', chinofarmersRouter);

const salesRoutes = require('./routes/sales')
app.use('/api/sales', salesRoutes)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const poeApi = require('./poeApiClient');

app.get('/api/cheapest', async (_req, res) => {
  try {
    const query  = { query: { filters: {}, type: 'Chaos Orb' }, sort: { price: 'asc' } };
    const result = await poeApi.getCheapestListing(query);
    res.json(result);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`);
});