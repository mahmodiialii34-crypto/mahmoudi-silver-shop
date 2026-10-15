const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'mahmoudi2026';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const telegramNotificationsInFlight = new Map();
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || process.env.ADMIN_ID;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function emptyStore() {
  return {
    products: [],
    payment: null,
    branding: { logo: null },
    loyalty: { current: 120, customers: [] },
    discounts: [],
    orders: []
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
  const tempFile = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tempFile, STORE_FILE);
}

const app = express();
app.use(express.json({ limit: '50mb' }));
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

app.get('/api/branding', (_req, res) => {
  res.json({ ok: true, branding: readStore().branding || { logo: null } });
});

app.put('/api/branding', requireAdmin, (req, res) => {
  const branding = req.body.branding;
  const imageFields = ['logo', 'heroBackground'];
  if (!branding || typeof branding !== 'object' || Array.isArray(branding)) {
    return res.status(400).json({ ok: false, error: 'branding must be an object' });
  }
  for (const field of imageFields) {
    if (Object.prototype.hasOwnProperty.call(branding, field) &&
        branding[field] !== null &&
        (typeof branding[field] !== 'string' || !/^data:image\/(?:jpeg|png|webp);base64,/.test(branding[field]))) {
      return res.status(400).json({ ok: false, error: `${field} must be an image data URL or null` });
    }
  }
  if (Object.keys(branding).some(field => !imageFields.includes(field))) {
    return res.status(400).json({ ok: false, error: 'unsupported branding field' });
  }
  const store = readStore();
  store.branding = { ...(store.branding || {}), ...branding };
  writeStore(store);
  res.json({ ok: true, branding: store.branding });
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

app.get('/api/orders', requireAdmin, (_req, res) => {
  res.json({ ok: true, orders: readStore().orders || [] });
});

function telegramOrderMessage(order) {
  const items = (order.items || []).map(item =>
    `- ${item.name}${item.size ? ` (${item.size})` : ''} × ${item.qty} — ${item.price} تومان`
  );
  return [
    '🛍️ سفارش جدید از گالری نقره محمودی',
    `کد سفارش: ${order.orderId}`,
    `نام مشتری: ${order.address?.name || '—'}`,
    `شماره تماس: ${order.address?.phone || '—'}`,
    `شهر: ${order.address?.city || '—'}`,
    `آدرس: ${order.address?.full || '—'}`,
    `کد پستی: ${order.address?.postal || '—'}`,
    `روش ارسال: ${order.shipping?.name || '—'}`,
    `مبلغ نهایی: ${Number(order.total || 0).toLocaleString('fa-IR')} تومان`,
    `۴ رقم آخر کارت: ${order.last4 || '—'}`,
    'محصولات:',
    ...items
  ].join('\n').slice(0, 4000);
}

async function sendTelegramRequest(method, body, isForm = false) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram ${method} failed: ${result.description || response.status}`);
  }
  return result;
}

async function notifyTelegram(order) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;

  if (!order.telegramMessageSentAt) {
    await sendTelegramRequest('sendMessage', {
      chat_id: TELEGRAM_CHAT_ID,
      text: telegramOrderMessage(order)
    });
    order.telegramMessageSentAt = new Date().toISOString();
  }

  if (!order.telegramReceiptSentAt && order.receiptImage) {
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(order.receiptImage);
    if (!match) throw new Error('Order receipt is not a supported image');
    const mimeType = `image/${match[1]}`;
    const form = new FormData();
    form.append('chat_id', TELEGRAM_CHAT_ID);
    form.append('caption', `رسید پرداخت سفارش ${order.orderId}`);
    form.append('photo', new Blob([Buffer.from(match[2], 'base64')], { type: mimeType }), `receipt.${match[1]}`);
    await sendTelegramRequest('sendPhoto', form, true);
    order.telegramReceiptSentAt = new Date().toISOString();
  }
  return true;
}

function notifyTelegramOnce(order) {
  const pending = telegramNotificationsInFlight.get(order.orderId);
  if (pending) return pending;
  const notification = notifyTelegram(order).finally(() => {
    telegramNotificationsInFlight.delete(order.orderId);
  });
  telegramNotificationsInFlight.set(order.orderId, notification);
  return notification;
}

function persistTelegramStatus(order) {
  const store = readStore();
  const savedOrder = (store.orders || []).find(item => item.orderId === order.orderId);
  if (!savedOrder) return null;
  for (const field of ['telegramMessageSentAt', 'telegramReceiptSentAt']) {
    if (order[field]) savedOrder[field] = order[field];
  }
  writeStore(store);
  return savedOrder;
}

app.post('/api/orders', (req, res) => {
  const incoming = req.body && (req.body.order || req.body);
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) ||
      typeof incoming.orderId !== 'string' || !incoming.orderId.trim()) {
    return res.status(400).json({ ok: false, error: 'orderId is required' });
  }
  if (typeof incoming.receiptImage !== 'string' ||
      !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(incoming.receiptImage)) {
    return res.status(400).json({ ok: false, error: 'receiptImage must be a supported image data URL' });
  }

  const store = readStore();
  store.orders = Array.isArray(store.orders) ? store.orders : [];
  const existingIndex = store.orders.findIndex(item => item.orderId === incoming.orderId);
  let order;
  if (existingIndex >= 0) {
    order = { ...incoming, ...store.orders[existingIndex] };
    store.orders[existingIndex] = order;
  } else {
    order = incoming;
    store.orders.unshift(order);
  }
  store.orders = store.orders.slice(0, 50);
  writeStore(store);

  notifyTelegramOnce(order).then(telegramSent => {
    const savedOrder = persistTelegramStatus(order) || order;
    if (!telegramSent) {
      return res.status(503).json({
        ok: false,
        saved: true,
        telegramSent: false,
        error: 'telegram_not_configured',
        order: savedOrder
      });
    }
    res.json({ ok: true, saved: true, telegramSent: true, order: savedOrder });
  }).catch(error => {
    console.error('Telegram order notification failed:', error.message);
    const savedOrder = persistTelegramStatus(order) || order;
    const configured = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
    if (res.headersSent) return;
    res.status(configured ? 502 : 503).json({
      ok: false,
      saved: true,
      telegramSent: false,
      error: configured ? 'telegram_send_failed' : 'telegram_not_configured',
      order: savedOrder
    });
  });
});

app.put('/api/orders', requireAdmin, (req, res) => {
  const store = readStore();
  store.orders = Array.isArray(req.body.orders) ? req.body.orders : (Array.isArray(req.body) ? req.body : []);
  writeStore(store);
  res.json({ ok: true, count: store.orders.length });
});

app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log('Shop API listening on', PORT);
});
