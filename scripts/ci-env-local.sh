#!/bin/sh
# Writes .env.local for CI from the running local Supabase stack. Used by the
# end-to-end and Lighthouse jobs in .github/workflows/ci.yml.
set -eu

npx supabase status -o env \
  --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
  --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
  > .env.local
{
  echo "NEXT_PUBLIC_APP_URL=http://localhost:3000"
  echo "EMAIL_PROVIDER=mailpit"
  echo "MAILPIT_URL=http://127.0.0.1:54324"
  # The record of deleted accounts (KRB-186), checked by tests/e2e/account.spec.ts.
  echo "ACCOUNT_DELETION_LOG_EMAIL=suppressions@kolabreport.test"
  echo "AI_PROVIDER=mock"
  echo "AI_DRAFTS_ENABLED=true"
  echo "AI_RATE_LIMIT_PER_HOUR=5"
  # The storage cleanup test calls the cron route with it.
  echo "CRON_SECRET=$(openssl rand -hex 32)"
  # FedaPay mock (tests/fedapay-mock/server.mjs), started by Playwright. It
  # reads the same key and webhook secret from this file.
  echo "FEDAPAY_ENVIRONMENT=mock"
  echo "FEDAPAY_API_BASE_URL=http://127.0.0.1:4010"
  echo "FEDAPAY_SECRET_KEY=sk_mock_$(openssl rand -hex 16)"
  echo "FEDAPAY_WEBHOOK_SECRET=wh_mock_$(openssl rand -hex 16)"
} >> .env.local
