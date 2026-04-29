ALTER TABLE payment_orders
  ADD COLUMN provider text NOT NULL DEFAULT 'mock';

CREATE INDEX idx_payment_orders_provider_status
  ON payment_orders(provider, status);
