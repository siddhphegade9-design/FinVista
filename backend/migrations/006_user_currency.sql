-- Multi-currency mode: each user picks the currency their amounts are shown in.
-- Changing it only changes labels and which country-specific tools are open (Indian tax is INR only).
-- Stored amounts are never converted.
ALTER TABLE users
  ADD COLUMN currency text NOT NULL DEFAULT 'INR'
  CHECK (currency IN ('INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'));
