-- Milestone 11: the figures a user enters for the tax estimator, one row per user per tax year.
-- Only inputs are stored. Tax is always recalculated from the rules in code, never saved.

CREATE TABLE tax_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tax_year    text NOT NULL CHECK (tax_year ~ '^\d{4}-\d{2}$'),
  inputs      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tax_year)
);
CREATE INDEX tax_profiles_user_idx ON tax_profiles (user_id);
CREATE TRIGGER tax_profiles_set_updated_at BEFORE UPDATE ON tax_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
