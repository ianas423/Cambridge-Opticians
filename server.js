const path = require('path');
const express = require('express');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://tahabangash@localhost:5432/cambridge_opticians',
});

const app = express();
app.use(express.json());

const STATUSES = ['placed', 'lab', 'glazing', 'qc', 'ready', 'delivered'];

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_num TEXT UNIQUE NOT NULL,
      patient_id TEXT,
      patient_name TEXT NOT NULL,
      patient_phone TEXT,
      items JSONB NOT NULL DEFAULT '[]',
      fitting_fee NUMERIC NOT NULL DEFAULT 0,
      gross NUMERIC NOT NULL DEFAULT 0,
      discount NUMERIC NOT NULL DEFAULT 0,
      net NUMERIC NOT NULL DEFAULT 0,
      deposit NUMERIC NOT NULL DEFAULT 0,
      balance NUMERIC NOT NULL DEFAULT 0,
      payment_mode TEXT NOT NULL DEFAULT 'Cash',
      lab_status TEXT NOT NULL DEFAULT 'placed',
      order_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS orders_lab_status_idx ON orders (lab_status);
  `);
}

function fmtDate(d) {
  if (d instanceof Date) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
  return String(d).split('T')[0];
}

function toApi(row) {
  return {
    id: String(row.id),
    orderNum: row.order_num,
    patientId: row.patient_id,
    patientName: row.patient_name,
    patientPhone: row.patient_phone,
    items: row.items,
    fittingFee: Number(row.fitting_fee),
    gross: Number(row.gross),
    discount: Number(row.discount),
    net: Number(row.net),
    deposit: Number(row.deposit),
    balance: Number(row.balance),
    paymentMode: row.payment_mode,
    labStatus: row.lab_status,
    date: fmtDate(row.order_date),
  };
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'postgresql' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/orders', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM orders ORDER BY id');
    res.json(rows.map(toApi));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  const b = req.body || {};
  if (!b.patientName || !Array.isArray(b.items) || b.items.length === 0) {
    return res.status(400).json({ error: 'patientName and non-empty items[] are required' });
  }
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  try {
    const { rows } = await pool.query(
      `INSERT INTO orders
        (order_num, patient_id, patient_name, patient_phone, items,
         fitting_fee, gross, discount, net, deposit, balance, payment_mode, lab_status, order_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'placed', $13)
       RETURNING *`,
      [
        `TMP-${Date.now()}`,
        b.patientId || null,
        b.patientName,
        b.patientPhone || '',
        JSON.stringify(b.items),
        num(b.fittingFee),
        num(b.gross),
        num(b.discount),
        num(b.net),
        num(b.deposit),
        num(b.balance),
        b.paymentMode || 'Cash',
        b.date || new Date().toISOString().split('T')[0],
      ]
    );
    const row = rows[0];
    const orderNum = `ORD-${new Date(row.order_date).getFullYear()}-${String(row.id).padStart(4, '0')}`;
    const updated = await pool.query(
      'UPDATE orders SET order_num = $1 WHERE id = $2 RETURNING *',
      [orderNum, row.id]
    );
    res.status(201).json(toApi(updated.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/orders/:id/status', async (req, res) => {
  const labStatus = req.body?.labStatus;
  if (!STATUSES.includes(labStatus)) {
    return res.status(400).json({ error: `labStatus must be one of: ${STATUSES.join(', ')}` });
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid order id' });
  try {
    const { rows } = await pool.query(
      'UPDATE orders SET lab_status = $1, updated_at = now() WHERE id = $2 RETURNING *',
      [labStatus, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'order not found' });
    res.json(toApi(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'indexx.html')));

const PORT = Number(process.env.PORT || 3000);
initSchema()
  .then(() => {
    app.listen(PORT, '127.0.0.1', () => {
      console.log(`Cambridge Opticians server on http://localhost:${PORT} (PostgreSQL connected)`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  });
