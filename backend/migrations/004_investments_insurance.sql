-- Milestone 8.5: SIP / recurring-investment records and insurance policies.
-- These are records the user enters. Nothing here is fetched from a bank or fund house, and any
-- "value" the app works out from them is a projection based on the return the user assumes.

CREATE TABLE sips (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name                    text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  instrument_type         text NOT NULL CHECK (instrument_type IN ('mutual_fund', 'elss', 'ppf', 'nps', 'stock', 'other')),
  monthly_amount          numeric(12, 2) NOT NULL CHECK (monthly_amount > 0),
  start_date              date NOT NULL,
  duration_months         integer CHECK (duration_months BETWEEN 1 AND 600), -- NULL = ongoing, no planned end
  step_up_percent         numeric(5, 2) NOT NULL DEFAULT 0 CHECK (step_up_percent BETWEEN 0 AND 50),       -- yearly increase of the instalment
  expected_return_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (expected_return_percent BETWEEN 0 AND 30), -- the user's own assumption, per year
  current_value           numeric(14, 2) CHECK (current_value >= 0),  -- optional: value from the user's own statement
  current_value_as_of     date,
  is_active               boolean NOT NULL DEFAULT true,
  notes                   text CHECK (notes IS NULL OR char_length(notes) <= 200),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK ((current_value IS NULL) = (current_value_as_of IS NULL))
);
CREATE INDEX sips_user_idx ON sips (user_id);
CREATE TRIGGER sips_set_updated_at BEFORE UPDATE ON sips FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE insurance_policies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  insurer           text CHECK (insurer IS NULL OR char_length(insurer) BETWEEN 1 AND 80),
  policy_type       text NOT NULL CHECK (policy_type IN ('health', 'term_life', 'life', 'motor', 'home', 'travel', 'other')),
  sum_assured       numeric(14, 2) NOT NULL CHECK (sum_assured > 0),
  premium           numeric(12, 2) NOT NULL CHECK (premium > 0),
  premium_frequency text NOT NULL CHECK (premium_frequency IN ('monthly', 'quarterly', 'half_yearly', 'yearly')),
  next_due_date     date NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  notes             text CHECK (notes IS NULL OR char_length(notes) <= 200),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX insurance_user_idx ON insurance_policies (user_id);
CREATE TRIGGER insurance_set_updated_at BEFORE UPDATE ON insurance_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
