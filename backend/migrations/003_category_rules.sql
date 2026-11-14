-- Milestone 7: expense categorisation.
-- 1) category_source gains 'default': no rule matched, so the transaction was placed in "Other" automatically.
--    (Only 'default' and 'rule' rows are ever re-categorised by rules; 'user' choices are never overridden.)
-- 2) category_rules: the user's own "description contains X -> category" rules.

ALTER TABLE transactions DROP CONSTRAINT transactions_category_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_category_source_check
  CHECK (category_source IN ('user', 'rule', 'ai', 'default'));

CREATE TABLE category_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  pattern     text NOT NULL CHECK (char_length(pattern) BETWEEN 3 AND 60),  -- normalised: lower case letters, digits, single spaces
  category_id uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('income', 'expense')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- The category must belong to the same user and have the same kind. Deleting a category deletes its rules.
  FOREIGN KEY (category_id, user_id, kind) REFERENCES categories (id, user_id, kind) ON DELETE CASCADE,
  UNIQUE (user_id, kind, pattern)
);
CREATE INDEX category_rules_user_idx ON category_rules (user_id);
CREATE TRIGGER category_rules_set_updated_at BEFORE UPDATE ON category_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
