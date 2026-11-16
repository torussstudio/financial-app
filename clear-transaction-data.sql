-- Clears the data behind: Documents, Purchases & bills, Daily vouchers, Income & expenses, Capital & investments.
-- KEEPS: company details, users, clients/vendors, projects, items, chart of accounts, budgets, recurring rules,
--        bank statement lines (they become "unmatched"), GST filing records and the audit log.
-- DELETES: documents, journal entries + lines, payment allocations, recurring postings, attachments, document/entry numbering.
-- Permanent. Take a Supabase backup first (Database > Backups) or run STEP 1 only to see what would go.
--
-- STEP 1 (read-only) - what will be deleted:
--   SELECT (SELECT count(*) FROM documents) AS documents, (SELECT count(*) FROM journal_entries) AS entries,
--          (SELECT count(*) FROM journal_lines) AS lines, (SELECT count(*) FROM allocations) AS allocations,
--          (SELECT count(*) FROM attachments WHERE entity_type IN ('DOCUMENT','ENTRY')) AS attachments;
--
-- STEP 2 - run everything below as one script.
BEGIN;
-- Posted records are protected by triggers; switch them off for this transaction only.
ALTER TABLE journal_entries DISABLE TRIGGER USER;
ALTER TABLE journal_lines   DISABLE TRIGGER USER;
ALTER TABLE allocations     DISABLE TRIGGER USER;
UPDATE bank_statement_lines SET matched_entry_id = NULL WHERE matched_entry_id IS NOT NULL;
DELETE FROM recurring_occurrences;
DELETE FROM allocations;
DELETE FROM journal_lines;
DELETE FROM journal_entries;
DELETE FROM attachments WHERE entity_type IN ('DOCUMENT','ENTRY');
DELETE FROM documents;
DELETE FROM sequences;
DELETE FROM idempotency;
ALTER TABLE journal_entries ENABLE TRIGGER USER;
ALTER TABLE journal_lines   ENABLE TRIGGER USER;
ALTER TABLE allocations     ENABLE TRIGGER USER;
-- Safety check: nothing else may have been touched.
DO $$ BEGIN
  IF (SELECT count(*) FROM users) = 0 OR (SELECT count(*) FROM company) = 0 THEN RAISE EXCEPTION 'users/company missing - rolling back'; END IF;
  IF (SELECT count(*) FROM journal_entries) <> 0 OR (SELECT count(*) FROM documents) <> 0 THEN RAISE EXCEPTION 'not fully cleared - rolling back'; END IF;
END $$;
COMMIT;
