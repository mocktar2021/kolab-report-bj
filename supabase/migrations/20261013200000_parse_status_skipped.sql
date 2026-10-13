-- =============================================================================
-- KolabReport: a parse status for files the app keeps but does not read
-- (Story KRB-14). PDF, PowerPoint, images and diagrams are stored and can be
-- downloaded, but nothing extracts their text yet. "skipped" says so instead
-- of leaving them "pending" forever.
--
-- On its own file: a new enum value cannot be used in the transaction that
-- adds it.
-- =============================================================================

alter type public.parse_status add value if not exists 'skipped';
