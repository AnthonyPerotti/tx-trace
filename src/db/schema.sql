PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Categories (user_id=NULL = global defaults)
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT NULL,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📦',
  color TEXT NOT NULL DEFAULT '#6366f1',
  is_default INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Payment institutions and accounts
CREATE TABLE IF NOT EXISTS payment_institutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'bank',
  color TEXT NOT NULL DEFAULT '#6366f1',
  credit_limit REAL DEFAULT NULL,
  invoice_closing_day INTEGER DEFAULT 5,
  invoice_due_day INTEGER DEFAULT 10,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Paid credit card invoices registry
CREATE TABLE IF NOT EXISTS card_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  institution_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  total_amount REAL NOT NULL DEFAULT 0,
  paid_at TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE(institution_id, year, month),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id) REFERENCES payment_institutions(id) ON DELETE CASCADE
);

-- Groups installment sets
CREATE TABLE IF NOT EXISTS installment_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  total_amount REAL NOT NULL,
  total_installments INTEGER NOT NULL,
  first_installment_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Main transactions
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'expense',
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  category_id INTEGER DEFAULT NULL,
  payment_method TEXT NOT NULL DEFAULT 'pix',
  institution_id INTEGER DEFAULT NULL,
  transaction_date TEXT NOT NULL,
  is_paid INTEGER NOT NULL DEFAULT 0,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurrence_day INTEGER DEFAULT NULL,
  recurrence_cancelled_at TEXT DEFAULT NULL,
  recurrence_parent_id INTEGER DEFAULT NULL,
  installment_group_id INTEGER DEFAULT NULL,
  installment_number INTEGER DEFAULT NULL,
  total_installments INTEGER DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (institution_id) REFERENCES payment_institutions(id) ON DELETE SET NULL,
  FOREIGN KEY (installment_group_id) REFERENCES installment_groups(id) ON DELETE SET NULL,
  FOREIGN KEY (recurrence_parent_id) REFERENCES transactions(id) ON DELETE CASCADE
);

-- Loans (money lent out)
CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  borrower_name TEXT NOT NULL,
  principal_amount REAL NOT NULL,
  loan_date TEXT NOT NULL,
  payment_source TEXT NOT NULL DEFAULT 'bank_account',
  institution_id INTEGER DEFAULT NULL,
  total_installments INTEGER NOT NULL DEFAULT 1,
  first_installment_date TEXT NOT NULL,
  notes TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id) REFERENCES payment_institutions(id) ON DELETE SET NULL
);

-- Loan installments (tracking the principal lent out)
CREATE TABLE IF NOT EXISTS loan_installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL,
  installment_number INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL,
  is_paid INTEGER NOT NULL DEFAULT 0,
  paid_date TEXT DEFAULT NULL,
  FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE
);

-- Return configuration (can have different installment structure)
CREATE TABLE IF NOT EXISTS loan_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL UNIQUE,
  total_return_amount REAL NOT NULL,
  total_installments INTEGER NOT NULL,
  first_installment_date TEXT NOT NULL,
  notes TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE
);

-- Individual return installments
CREATE TABLE IF NOT EXISTS loan_return_installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_return_id INTEGER NOT NULL,
  installment_number INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL,
  is_received INTEGER NOT NULL DEFAULT 0,
  received_date TEXT DEFAULT NULL,
  FOREIGN KEY (loan_return_id) REFERENCES loan_returns(id) ON DELETE CASCADE
);

-- Seed global default categories
INSERT OR IGNORE INTO categories (id, user_id, name, icon, color, is_default) VALUES
  (1,  NULL, 'Alimentação', '🍔', '#f97316', 1),
  (2,  NULL, 'Assinatura',  '📺', '#8b5cf6', 1),
  (3,  NULL, 'Transporte',  '🚗', '#3b82f6', 1),
  (4,  NULL, 'Empréstimo',  '🤝', '#ef4444', 1),
  (5,  NULL, 'Saúde',       '💊', '#10b981', 1),
  (6,  NULL, 'Lazer',       '🎮', '#f59e0b', 1),
  (7,  NULL, 'Moradia',     '🏠', '#06b6d4', 1),
  (8,  NULL, 'Vestuário',   '👕', '#ec4899', 1),
  (9,  NULL, 'Serviços',    '⚙️', '#64748b', 1),
  (10, NULL, 'Outros',      '📦', '#94a3b8', 1);
