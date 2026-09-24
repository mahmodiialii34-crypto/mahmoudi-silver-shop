const express = require('express');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'mahmoudi2026';
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
function emptyStore() {
  return {
    products: [],
    payment: null,
    loyalty: { current: 120, customers: [] },
    discounts: []
  };
}
function readStore() {
  try {
    if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch (e) {
    console.warn('readStore', e.message);
  }
  return emptyStore();
}
function writeStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
}
const app = express();
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || '';
  if (key !== ADMIN_SECRET) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.get('/api/products', (_req, res) => {
  res.json({ ok: true, products: readStore().products || [] });
});
app.put('/api/products', requireAdmin, (req, res) => {
  if (!Array.isArray(req.body.products)) {
    return res.status(400).json({ ok: false, error: 'products must be array' });
  }
  const store = readStore();
  store.products = req.body.products;
  writeStore(store);
  res.json({ ok: true, count: store.products.length });
});
app.get('/api/payment', (_req, res) => {
  res.json({ ok: true, payment: readStore().payment });
});
app.put('/api/payment', requireAdmin, (req, res) => {
  const store = readStore();
  store.payment = req.body.payment || req.body;
  writeStore(store);
  res.json({ ok: true, payment: store.payment });
});
app.get('/api/loyalty', (_req, res) => {
  res.json({ ok: true, loyalty: readStore().loyalty || { current: 120, customers: [] } });
});
app.put('/api/loyalty', requireAdmin, (req, res) => {
  const store = readStore();
  store.loyalty = req.body.loyalty || req.body;
  writeStore(store);
  res.json({ ok: true });
});
app.get('/api/discounts', (_req, res) => {
  res.json({ ok: true, discounts: readStore().discounts || [] });
});
app.put('/api/discounts', requireAdmin, (req, res) => {
  const store = readStore();
  store.discounts = req.body.discounts || req.body;
  writeStore(store);
  res.json({ ok: true });
});
app.use(express.static(__dirname));
app.listen(PORT, () => {
  console.log('Shop API listening on', PORT);
});
