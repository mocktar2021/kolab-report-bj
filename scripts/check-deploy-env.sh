#!/usr/bin/env sh
# Fails with one clear message per missing setting before a deploy touches
# anything. Settings live on the GitHub environment (see docs/deployment.md).
missing=""
for name in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "::error::$name is not set on the ${GITHUB_JOB:-current} environment."
    missing="yes"
  fi
done
[ -z "$missing" ]
