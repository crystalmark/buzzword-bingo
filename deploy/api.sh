#!/usr/bin/env bash
# Deploy the Buzzword Bingo API (template.yaml) as the CloudFormation stack buzzword-bingo in eu-west-2. Safe to re-run.
# The origin secret CloudFront sends is made once and kept in SSM, so redeploys and deploy/cloudfront.sh agree on it.
set -euo pipefail
cd "$(dirname "$0")/.."
REGION=${BINGO_REGION:-eu-west-2}
STACK=buzzword-bingo
PARAM=/buzzword-bingo/origin-secret

npm test > /dev/null 2>&1 || { echo "Tests failed: run npm test"; exit 1; }

if ! SECRET=$(aws ssm get-parameter --region "$REGION" --name "$PARAM" --with-decryption --query Parameter.Value --output text 2> /dev/null); then
  SECRET=$(openssl rand -hex 32)
  aws ssm put-parameter --region "$REGION" --name "$PARAM" --type SecureString --value "$SECRET" > /dev/null
  echo "Origin secret made and stored in SSM $PARAM"
fi

sam deploy --region "$REGION" --stack-name "$STACK" --template-file template.yaml --resolve-s3 \
  --capabilities CAPABILITY_IAM --no-confirm-changeset --no-fail-on-empty-changeset \
  --parameter-overrides "OriginSecret=$SECRET"

echo "API: $(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='ApiDomain'].OutputValue" --output text)"
