CREATE TABLE IF NOT EXISTS commerce_orders (
  order_number TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  paypal_order_id TEXT UNIQUE,
  paypal_capture_id TEXT,
  payload TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'payment_pending',
  order_status TEXT NOT NULL DEFAULT 'order_created',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commerce_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commerce_outbox_pending ON commerce_outbox(synced_at, id);
CREATE TABLE IF NOT EXISTS commerce_requests (external_id TEXT PRIMARY KEY,request_type TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS pay_later_orders (
  order_number TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  customer_id TEXT,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  order_status TEXT NOT NULL DEFAULT 'review_required',
  pay_later_status TEXT NOT NULL DEFAULT 'review_required',
  due_date TEXT,
  approved_at TEXT,
  shipped_at TEXT,
  paid_at TEXT,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  last_reminder_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(order_number) REFERENCES commerce_orders(order_number)
);
CREATE INDEX IF NOT EXISTS idx_pay_later_email_open ON pay_later_orders(email_normalized,payment_status,pay_later_status);
