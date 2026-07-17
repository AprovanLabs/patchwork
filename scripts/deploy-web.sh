#!/usr/bin/env bash
#
# Build the patchwork web app and publish it to aprovan.com/chat.
#
# Builds @aprovan/patchwork-web (Vite base /chat/ — set in vite.config.ts),
# syncs the static output into the chat/ prefix of the shared aprovan.com S3
# bucket (owned by core's WebStack), and invalidates the CloudFront cache for
# /chat/*.
#
# Cognito / gateway config is baked into the build by client/web/scripts/
# load-env.ts, which reads the shared identity bundle from SSM
# /aprovan/<env>/env (VITE_COGNITO_* / VITE_MCP_URL) using the same AWS
# credentials this script runs with.
#
# Usage:
#   AWS_PROFILE=aprovan scripts/deploy-web.sh          # local
#   scripts/deploy-web.sh                              # CI (OIDC creds ambient)
#
# Config (all optional — resolved from SSM/core infra when unset):
#   WEB_BUCKET                  target S3 bucket (SSM /aprovan/<env>/web/bucket)
#   CLOUDFRONT_DISTRIBUTION_ID  aprovan.com distribution (SSM .../web/distribution-id)
#   SKIP_BUILD=1                reuse an existing client/web/dist

source "$(dirname "${BASH_SOURCE[0]}")/deploy-lib.sh"

resolve WEB_BUCKET "$WEB_REGION" "/aprovan/${ENVIRONMENT}/web/bucket" "web bucket"
resolve CLOUDFRONT_DISTRIBUTION_ID "$WEB_REGION" \
  "/aprovan/${ENVIRONMENT}/web/distribution-id" "distribution id"

DIST_DIR="$REPO_ROOT/client/web/dist"

# Pin the gateway MCP URL for the build. load-env.ts also derives this from the
# shared SSM env, but a developer's client/web/.env (loaded first via dotenv)
# can shadow GATEWAY_URL with a localhost value — an explicit VITE_MCP_URL
# always wins over both.
if [[ -z "${VITE_MCP_URL:-}" ]]; then
  GATEWAY_URL="$(shared_env_value GATEWAY_URL)"
  [[ -n "$GATEWAY_URL" ]] ||
    die "GATEWAY_URL unresolved (checked SSM /aprovan/${ENVIRONMENT}/env). Set VITE_MCP_URL explicitly."
  VITE_MCP_URL="${GATEWAY_URL%/}/mcp"
fi
log "Gateway MCP URL: $VITE_MCP_URL"

if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  log "Building @aprovan/patchwork-web (base /chat, env $ENVIRONMENT)"
  (
    cd "$REPO_ROOT"
    APROVAN_ENV="$ENVIRONMENT" \
    AWS_REGION="$AWS_REGION" \
    VITE_MCP_URL="$VITE_MCP_URL" \
      pnpm --filter @aprovan/patchwork-web build
  )
fi

[[ -f "$DIST_DIR/index.html" ]] ||
  die "$DIST_DIR/index.html missing — build did not produce output."

log "Syncing $DIST_DIR → s3://$WEB_BUCKET/chat/"
# Fingerprinted assets: long-cache. HTML: always revalidate so a deploy is
# visible as soon as the invalidation completes.
awscli "$WEB_REGION" s3 sync "$DIST_DIR" "s3://$WEB_BUCKET/chat/" \
  --delete \
  --exclude "*.html" \
  --cache-control "public,max-age=31536000,immutable"
awscli "$WEB_REGION" s3 sync "$DIST_DIR" "s3://$WEB_BUCKET/chat/" \
  --delete \
  --exclude "*" --include "*.html" \
  --cache-control "public,max-age=0,must-revalidate" \
  --content-type "text/html; charset=utf-8"

# The app is a single-page Vite build, but CloudFront's static rewrite maps
# /chat/auth/callback → chat/auth/callback/index.html. Publish a copy of the
# SPA shell at that key so the Cognito redirect lands on the app. (Runs after
# the --delete syncs, which would otherwise remove it.)
log "Publishing SPA shell at chat/auth/callback/"
awscli "$WEB_REGION" s3 cp "$DIST_DIR/index.html" \
  "s3://$WEB_BUCKET/chat/auth/callback/index.html" \
  --cache-control "public,max-age=0,must-revalidate" \
  --content-type "text/html; charset=utf-8"

log "Invalidating CloudFront $CLOUDFRONT_DISTRIBUTION_ID (/chat/*)"
INVALIDATION_ID="$(awscli "$WEB_REGION" cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/chat/*" \
  --query 'Invalidation.Id' --output text)"

log "Done. https://aprovan.com/chat/ (invalidation $INVALIDATION_ID)"
