
CREATE TABLE IF NOT EXISTS schema_versions(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS company(id text PRIMARY KEY CHECK(id='company'),name text NOT NULL,address text NOT NULL DEFAULT '',gstin text,state_code text NOT NULL DEFAULT '32',currency text NOT NULL DEFAULT 'INR' CHECK(currency='INR'),demo boolean NOT NULL DEFAULT false,closed_through date,bank_details text NOT NULL DEFAULT '',terms text NOT NULL DEFAULT 'Payment due within 15 days.',created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE company ADD COLUMN IF NOT EXISTS address_line2 text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS state_name text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS pin_code text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS contact_number text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS account_holder_name text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS bank_name text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS account_number text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS ifsc_code text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS branch_name text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS gst_logo text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_logo text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_name text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_address text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_address_line2 text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_city text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_state_name text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_state_code text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_pin_code text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_contact_number text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_account_holder_name text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_bank_name text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_account_number text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_ifsc_code text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_branch_name text NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS non_gst_bank_details text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY,email text UNIQUE NOT NULL,name text NOT NULL,password_hash text NOT NULL,role text NOT NULL CHECK(role IN ('ADMIN','ACCOUNTANT','VIEWER')),active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS sessions(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),csrf text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS accounts(code text PRIMARY KEY,name text NOT NULL,kind text NOT NULL CHECK(kind IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),is_cash boolean NOT NULL DEFAULT false);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS voucher_category_kind text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS parties(id text PRIMARY KEY,name text NOT NULL,email text NOT NULL DEFAULT '',phone text NOT NULL DEFAULT '',address text NOT NULL DEFAULT '',gstin text,kind text NOT NULL CHECK(kind IN ('CLIENT','VENDOR','BOTH')),created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE parties ADD COLUMN IF NOT EXISTS contact_name text NOT NULL DEFAULT '';
ALTER TABLE parties ADD COLUMN IF NOT EXISTS voucher_category_kind text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS projects(id text PRIMARY KEY,name text NOT NULL,party_id text REFERENCES parties(id),budget numeric(18,2) NOT NULL DEFAULT 0 CHECK(budget>=0));
CREATE TABLE IF NOT EXISTS sequences(prefix text NOT NULL,fy text NOT NULL,next_value integer NOT NULL DEFAULT 1,PRIMARY KEY(prefix,fy));
CREATE TABLE IF NOT EXISTS documents(id text PRIMARY KEY,number text UNIQUE NOT NULL,kind text NOT NULL CHECK(kind IN ('QUOTATION','PROFORMA','INVOICE','BILL')),status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ISSUED')),party_id text NOT NULL REFERENCES parties(id),project_id text REFERENCES projects(id),issue_date date NOT NULL,due_date date NOT NULL,tax_treatment text NOT NULL CHECK(tax_treatment IN ('TAXABLE','NIL_RATED','EXEMPT','OUTSIDE_GST')),tax_reason text NOT NULL DEFAULT '',place_of_supply text NOT NULL,interstate boolean NOT NULL,expense_account text NOT NULL DEFAULT '5100' REFERENCES accounts(code),subtotal numeric(18,2) NOT NULL,tax numeric(18,2) NOT NULL,total numeric(18,2) NOT NULL CHECK(total>=0),lines jsonb NOT NULL,snapshot jsonb,notes text NOT NULL DEFAULT '',payment_method text CHECK(payment_method IN ('Cash','Bank Transfer','Cheque')),source_id text REFERENCES documents(id),created_by text REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE documents ADD COLUMN IF NOT EXISTS payment_method text CHECK(payment_method IN ('Cash','Bank Transfer','Cheque'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'INR';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS advance_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK(advance_amount>=0);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS advance_status text NOT NULL DEFAULT 'NOT_RECEIVED' CHECK(advance_status IN ('NOT_RECEIVED','PARTIALLY_RECEIVED','FULLY_RECEIVED'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS client_snapshot jsonb;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS company_snapshot jsonb;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS income_account text NOT NULL DEFAULT '4000' REFERENCES accounts(code);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS advance_account text REFERENCES accounts(code);
-- A quotation converts to at most one live invoice; a cancelled invoice draft frees it for another conversion.
DROP INDEX IF EXISTS one_conversion;
CREATE UNIQUE INDEX IF NOT EXISTS one_active_conversion ON documents(source_id) WHERE kind='INVOICE' AND source_id IS NOT NULL AND status<>'CANCELLED';
CREATE TABLE IF NOT EXISTS journal_entries(id text PRIMARY KEY,number text NOT NULL UNIQUE,entry_date date NOT NULL,kind text NOT NULL,description text NOT NULL,party_id text REFERENCES parties(id),project_id text REFERENCES projects(id),document_id text UNIQUE REFERENCES documents(id),reversal_of text UNIQUE REFERENCES journal_entries(id),snapshot jsonb,posting_tx bigint NOT NULL DEFAULT txid_current(),created_by text REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS journal_lines(id text PRIMARY KEY,entry_id text NOT NULL REFERENCES journal_entries(id),account_code text NOT NULL REFERENCES accounts(code),debit numeric(18,2) NOT NULL DEFAULT 0,credit numeric(18,2) NOT NULL DEFAULT 0,CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)));
CREATE INDEX IF NOT EXISTS line_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS entry_date ON journal_entries(entry_date);
CREATE TABLE IF NOT EXISTS allocations(id text PRIMARY KEY,entry_id text NOT NULL REFERENCES journal_entries(id),document_id text NOT NULL REFERENCES documents(id),amount numeric(18,2) NOT NULL CHECK(amount>0),UNIQUE(entry_id,document_id));
CREATE TABLE IF NOT EXISTS idempotency(key text PRIMARY KEY,actor_id text NOT NULL REFERENCES users(id),fingerprint text NOT NULL,response jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events(id text PRIMARY KEY,actor_id text REFERENCES users(id),action text NOT NULL,entity_id text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS budgets(id text PRIMARY KEY,month text NOT NULL,account_code text NOT NULL REFERENCES accounts(code),amount numeric(18,2) NOT NULL CHECK(amount>=0),UNIQUE(month,account_code));
CREATE TABLE IF NOT EXISTS bank_statement_lines(id text PRIMARY KEY,account_code text NOT NULL REFERENCES accounts(code),entry_date date NOT NULL,reference text NOT NULL,description text NOT NULL,amount numeric(18,2) NOT NULL CHECK(amount<>0),matched_entry_id text REFERENCES journal_entries(id));
CREATE TABLE IF NOT EXISTS recurring_rules(id text PRIMARY KEY,name text NOT NULL,kind text NOT NULL CHECK(kind IN ('INCOME','EXPENSE')),account_code text NOT NULL REFERENCES accounts(code),cash_account text NOT NULL REFERENCES accounts(code),amount numeric(18,2) NOT NULL CHECK(amount>0),day integer NOT NULL CHECK(day BETWEEN 1 AND 28),active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS recurring_occurrences(id text PRIMARY KEY,rule_id text NOT NULL REFERENCES recurring_rules(id),month text NOT NULL,entry_id text UNIQUE REFERENCES journal_entries(id),UNIQUE(rule_id,month));
CREATE OR REPLACE FUNCTION verify_balanced_entry() RETURNS trigger AS $$
DECLARE target text; total_debit numeric; total_credit numeric; count_lines integer;
BEGIN
 IF TG_TABLE_NAME='journal_entries' THEN target:=NEW.id; ELSE target:=NEW.entry_id; END IF;
 SELECT COALESCE(SUM(debit),0),COALESCE(SUM(credit),0),COUNT(*) INTO total_debit,total_credit,count_lines FROM journal_lines WHERE entry_id=target;
 IF count_lines<2 OR total_debit<>total_credit THEN RAISE EXCEPTION 'Journal must have balanced debit and credit lines'; END IF;
 RETURN NULL;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS entry_balance ON journal_entries;
CREATE CONSTRAINT TRIGGER entry_balance AFTER INSERT ON journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_balanced_entry();
DROP TRIGGER IF EXISTS lines_balance ON journal_lines;
CREATE CONSTRAINT TRIGGER lines_balance AFTER INSERT ON journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_balanced_entry();
CREATE OR REPLACE FUNCTION immutable_financial_record() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Posted accounting records are immutable; create a reversal'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS immutable_entries ON journal_entries;
CREATE TRIGGER immutable_entries BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION immutable_financial_record();
DROP TRIGGER IF EXISTS immutable_lines ON journal_lines;
CREATE TRIGGER immutable_lines BEFORE UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION immutable_financial_record();
DROP TRIGGER IF EXISTS immutable_audit ON audit_events;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION immutable_financial_record();
INSERT INTO schema_versions(version) VALUES(1) ON CONFLICT DO NOTHING;


CREATE OR REPLACE FUNCTION protect_posted_lines() RETURNS trigger AS $$ BEGIN IF (SELECT posting_tx FROM journal_entries WHERE id=NEW.entry_id)<>txid_current() THEN RAISE EXCEPTION 'Cannot append lines to a posted journal'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS no_late_lines ON journal_lines;
CREATE TRIGGER no_late_lines BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION protect_posted_lines();
DROP TRIGGER IF EXISTS immutable_allocations ON allocations;
CREATE TRIGGER immutable_allocations BEFORE UPDATE OR DELETE ON allocations FOR EACH ROW EXECUTE FUNCTION immutable_financial_record();
CREATE UNIQUE INDEX IF NOT EXISTS unique_bank_match ON bank_statement_lines(account_code,matched_entry_id) WHERE matched_entry_id IS NOT NULL;
-- Identical statement rows inside one import are separate transactions; only a re-import of the same row is a duplicate.
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS occurrence integer NOT NULL DEFAULT 1 CHECK(occurrence>0);
DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='bank_statement_lines'::regclass AND contype='u' LOOP
  EXECUTE format('ALTER TABLE bank_statement_lines DROP CONSTRAINT %I', c);
 END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS bank_line_dedupe ON bank_statement_lines(account_code,reference,entry_date,amount,occurrence);
-- Corrections: credit notes, cancelled documents, and negative allocations that offset a reversed receipt.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_kind_check;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE allocations DROP CONSTRAINT IF EXISTS allocations_amount_check;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documents_kind_valid') THEN
  ALTER TABLE documents ADD CONSTRAINT documents_kind_valid CHECK(kind IN ('QUOTATION','PROFORMA','INVOICE','BILL','CREDIT_NOTE'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documents_status_valid') THEN
  ALTER TABLE documents ADD CONSTRAINT documents_status_valid CHECK(status IN ('DRAFT','ISSUED','CANCELLED'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='allocations_amount_nonzero') THEN
  ALTER TABLE allocations ADD CONSTRAINT allocations_amount_nonzero CHECK(amount<>0);
 END IF;
END $$;
-- Version 2: owner and reimbursement categories become data (parties.voucher_category_kind, comma separated) instead of names in code.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM schema_versions WHERE version=2) THEN
  UPDATE parties SET voucher_category_kind='CAPITAL_IN,REIMBURSEMENT' WHERE voucher_category_kind='' AND lower(trim(name))='rohini';
  UPDATE parties SET voucher_category_kind='CAPITAL_RETURN' WHERE voucher_category_kind='' AND lower(trim(name))='rohini k';
  UPDATE parties SET voucher_category_kind='REIMBURSEMENT' WHERE voucher_category_kind='' AND lower(trim(name))='sreejith';
  INSERT INTO schema_versions(version) VALUES(2);
 END IF;
END $$;
