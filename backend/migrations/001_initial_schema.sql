-- FinVista initial schema (PostgreSQL 13+).
-- Money is NUMERIC(12,2), never float. Every user-owned row carries user_id and
-- cross-table foreign keys include user_id so one user's rows can never point at another's.

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL CHECK (char_length(email) <= 254 AND position('@' IN email) > 1),
  password_hash text NOT NULL,
  full_name     text NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 100),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Emails are unique ignoring case.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------ categories
CREATE TABLE categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  kind       text NOT NULL CHECK (kind IN ('income', 'expense')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Targets for composite foreign keys below.
  UNIQUE (id, user_id),
  UNIQUE (id, user_id, kind)
);
CREATE UNIQUE INDEX categories_user_kind_name_key ON categories (user_id, kind, lower(name));

-- ---------------------------------------------------------- transactions
CREATE TABLE transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category_id     uuid NOT NULL,
  type            text NOT NULL CHECK (type IN ('income', 'expense')),
  amount          numeric(12, 2) NOT NULL CHECK (amount > 0),
  description     text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
  occurred_on     date NOT NULL,
  -- How the category was chosen: typed/corrected by the user, matched by a rule, or suggested by AI.
  category_source text NOT NULL DEFAULT 'user' CHECK (category_source IN ('user', 'rule', 'ai')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- The category must belong to the same user AND have the same kind as the transaction type.
  FOREIGN KEY (category_id, user_id, type) REFERENCES categories (id, user_id, kind)
);
CREATE INDEX transactions_user_date_idx ON transactions (user_id, occurred_on DESC);
CREATE INDEX transactions_user_category_date_idx ON transactions (user_id, category_id, occurred_on DESC);
CREATE TRIGGER transactions_set_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------------------------------------------- budgets
-- category_id NULL means the overall budget for that month. Budgets are for expense
-- categories; the service layer enforces that (kind is not part of this FK).
CREATE TABLE budgets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category_id  uuid,
  month        date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1), -- first day of the month
  limit_amount numeric(12, 2) NOT NULL CHECK (limit_amount >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX budgets_user_month_category_key
  ON budgets (user_id, month, COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE TRIGGER budgets_set_updated_at BEFORE UPDATE ON budgets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
