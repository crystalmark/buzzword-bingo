#!/usr/bin/env bash
# One-off (safe to re-run): serve https://crystalmark.co.uk/bingo/ on the site's CloudFront distribution.
#   /bingo/api/*  → the HTTP API from deploy/api.sh (origin bingo-api, uncached, every viewer header but Host forwarded,
#                   with the X-Origin-Secret header the Lambda insists on)
#   /bingo*       → the site's S3 bucket, a copy of the default behaviour plus the deploy/bingo-index.js function
# Both get the security headers in deploy/bingo-headers.json. Other behaviours and origins (RT Trainer, Flight Log,
# Pollyglot) and the Lightsail host are left alone.
#   deploy/cloudfront.sh            function, headers policy, origin, behaviours; waits for it to deploy and checks
#   deploy/cloudfront.sh --remove   take the bingo behaviours and origin out again (the function and policy stay)
set -euo pipefail
cd "$(dirname "$0")"
DIST=${BINGO_DIST:-EZS3KVTVPEGYG}   # BINGO_ names only: a DIST left in the shell by another project would be changed
REGION=${BINGO_REGION:-eu-west-2}
FN=buzzword-bingo-index
POLICY=$(jq -r .Name bingo-headers.json)
ORIGIN=bingo-api
SITE=https://crystalmark.co.uk/bingo/
CACHING_DISABLED=4135ea2d-6df8-44a3-9df3-4b5a84be39ad        # AWS managed: Managed-CachingDisabled
ALL_VIEWER_EXCEPT_HOST=b689b0a8-53d0-40ab-baf2-68738e2966ac  # AWS managed: Managed-AllViewerExceptHostHeader
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT   # the distribution config carries the other apps' origin secrets

update_distribution() { # update_distribution [jq options] FILTER: apply a jq filter to the live distribution config
  aws cloudfront get-distribution-config --id "$DIST" --output json > "$TMP/dist.json"
  jq "$@" "$TMP/dist.json" > "$TMP/new.json"
  aws cloudfront update-distribution --id "$DIST" --if-match "$(jq -r .ETag "$TMP/dist.json")" \
    --distribution-config "file://$TMP/new.json" --query 'Distribution.Status' --output text
}

if [ "${1:-}" = --remove ]; then
  update_distribution --arg o "$ORIGIN" '.DistributionConfig
    | .CacheBehaviors.Items = [.CacheBehaviors.Items[] | select(.PathPattern | startswith("/bingo") | not)]
    | .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)
    | .Origins.Items = [.Origins.Items[] | select(.Id != $o)]
    | .Origins.Quantity = (.Origins.Items | length)'
  echo "Bingo behaviours and origin removed; the distribution takes a few minutes to deploy."
  exit 0
fi

API=$(aws cloudformation describe-stacks --region "$REGION" --stack-name buzzword-bingo \
  --query "Stacks[0].Outputs[?OutputKey=='ApiDomain'].OutputValue" --output text)
SECRET=$(aws ssm get-parameter --region "$REGION" --name /buzzword-bingo/origin-secret --with-decryption --query Parameter.Value --output text)
[ -n "$API" ] && [ -n "$SECRET" ] || { echo "Run deploy/api.sh first"; exit 1; }

# 1. The function: create or update the development stage, check it on CloudFront's runtime, then publish it
CONFIG='{"Comment":"Buzzword Bingo: /bingo to /bingo/, app routes to index.html","Runtime":"cloudfront-js-2.0"}'
if aws cloudfront describe-function --name "$FN" --stage DEVELOPMENT --output json > "$TMP/fn.json" 2> /dev/null; then
  ETAG=$(aws cloudfront update-function --name "$FN" --if-match "$(jq -r .ETag "$TMP/fn.json")" \
    --function-config "$CONFIG" --function-code fileb://bingo-index.js --query ETag --output text)
else
  ETAG=$(aws cloudfront create-function --name "$FN" --function-config "$CONFIG" --function-code fileb://bingo-index.js --query ETag --output text)
fi
check() { # check URI JQ_TEST: run the development stage on a viewer request for URI; JQ_TEST judges its output
  jq -n --arg uri "$1" '{version:"1.0",context:{eventType:"viewer-request"},viewer:{ip:"198.51.100.1"},
    request:{method:"GET",uri:$uri,querystring:{},headers:{},cookies:{}}}' > "$TMP/event.json"
  aws cloudfront test-function --name "$FN" --if-match "$ETAG" --stage DEVELOPMENT --event-object "fileb://$TMP/event.json" \
    --query TestResult --output json > "$TMP/result.json"
  jq -e ".FunctionOutput | fromjson | $2" "$TMP/result.json" > /dev/null || { echo "Function test failed for $1:"; jq . "$TMP/result.json"; exit 1; }
}
check /bingo '.response.statusCode == 301 and .response.headers.location.value == "/bingo/"'
check /bingo/ '.request.uri == "/bingo/index.html"'
check /bingo/KPTZ '.request.uri == "/bingo/index.html"'
check /bingo/solo '.request.uri == "/bingo/index.html"'
check /bingo/js/app.mjs '.request.uri == "/bingo/js/app.mjs"'
aws cloudfront publish-function --name "$FN" --if-match "$ETAG" > /dev/null
ARN=$(aws cloudfront describe-function --name "$FN" --stage LIVE --query 'FunctionSummary.FunctionMetadata.FunctionARN' --output text)
echo "Function $FN tested and published"

# 2. The security headers: created, or brought up to date if the policy is there already
RH=$(aws cloudfront list-response-headers-policies --type custom --output json | jq -r --arg n "$POLICY" \
  '[.ResponseHeadersPolicyList.Items[]?.ResponseHeadersPolicy | select(.ResponseHeadersPolicyConfig.Name == $n) | .Id][0] // empty')
if [ -n "$RH" ]; then
  aws cloudfront update-response-headers-policy --id "$RH" --if-match "$(aws cloudfront get-response-headers-policy --id "$RH" --query ETag --output text)" \
    --response-headers-policy-config file://bingo-headers.json > /dev/null
else
  RH=$(aws cloudfront create-response-headers-policy --response-headers-policy-config file://bingo-headers.json --query ResponseHeadersPolicy.Id --output text)
fi
echo "Response headers policy $POLICY ($RH) up to date"

# 3. The origin and the two behaviours, the API one first (CloudFront takes the first pattern that matches). Any bingo
# behaviours already there are replaced; everything else stays as it is, and where it is. A default behaviour that no
# longer points at S3, or has a headers policy of its own we'd silently drop, stops this rather than being copied.
update_distribution --arg o "$ORIGIN" --arg api "$API" --arg s "$SECRET" --arg fn "$ARN" --arg rh "$RH" \
  --arg nocache "$CACHING_DISABLED" --arg orp "$ALL_VIEWER_EXCEPT_HOST" '.DistributionConfig
  | .DefaultCacheBehavior as $d
  | if ($d.TargetOriginId | contains(".s3.")) then . else error("the default behaviour no longer points at the S3 bucket") end
  | if ($d.ResponseHeadersPolicyId // "") == "" then . else error("the default behaviour has a response headers policy of its own: add what it sends to bingo-headers.json first") end
  | .Origins.Items = ([.Origins.Items[] | select(.Id != $o)] + [{
      Id: $o, DomainName: $api, OriginPath: "",
      CustomHeaders: {Quantity: 1, Items: [{HeaderName: "X-Origin-Secret", HeaderValue: $s}]},
      CustomOriginConfig: {HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: "https-only",
        OriginSslProtocols: {Quantity: 1, Items: ["TLSv1.2"]}, OriginReadTimeout: 30, OriginKeepaliveTimeout: 5},
      ConnectionAttempts: 3, ConnectionTimeout: 10, OriginShield: {Enabled: false}, OriginAccessControlId: ""}])
  | .Origins.Quantity = (.Origins.Items | length)
  | .CacheBehaviors.Items = ([(.CacheBehaviors.Items // [])[] | select(.PathPattern | startswith("/bingo") | not)] + [
      {PathPattern: "/bingo/api/*", TargetOriginId: $o,
       TrustedSigners: {Enabled: false, Quantity: 0}, TrustedKeyGroups: {Enabled: false, Quantity: 0},
       ViewerProtocolPolicy: "redirect-to-https", SmoothStreaming: false, Compress: true,
       AllowedMethods: {Quantity: 7, Items: ["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"], CachedMethods: {Quantity: 2, Items: ["GET","HEAD"]}},
       CachePolicyId: $nocache, OriginRequestPolicyId: $orp, ResponseHeadersPolicyId: $rh,
       LambdaFunctionAssociations: {Quantity: 0}, FunctionAssociations: {Quantity: 0}, FieldLevelEncryptionId: ""},
      ($d + {PathPattern: "/bingo*", ResponseHeadersPolicyId: $rh,
       FunctionAssociations: {Quantity: 1, Items: [{FunctionARN: $fn, EventType: "viewer-request"}]}})])
  | .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)'
echo "Origin $ORIGIN ($API) and behaviours /bingo/api/*, /bingo* set; waiting for the distribution to deploy (usually a few minutes)"
aws cloudfront wait distribution-deployed --id "$DIST"

if curl -fs --max-time 10 -o /dev/null "$SITE"; then echo "Live: $SITE"
else echo "Distribution deployed; $SITE has no files yet: run deploy/deploy.sh"; fi
STATUS=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "${SITE}api/games/ZZZZ")
[ "$STATUS" = 404 ] && echo "API answering through CloudFront" || echo "Warning: ${SITE}api/games/ZZZZ gave $STATUS (expected 404)"
