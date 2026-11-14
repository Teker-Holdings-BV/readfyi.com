#!/usr/bin/env bash
# Builds packages/api and pushes the image to the private registry on the VPS
# (managed by the Teker-Holdings-BV/vps-iac repo).
#
#   npm run publish                 # tag: <UTC timestamp>-<git short sha>
#   npm run publish -- <tag>        # explicit tag (never "latest")
#
# Environment:
#   NPM_TOKEN       required: GitHub Packages token for the private @teker-holdings-bv packages
#   VPS_SSH         required: deploy@<server-ip>
#                   (in vps-iac: terraform -chdir=terraform output -raw ssh_command)
#   IMAGE_NAME      default api-readfyi-com
#   PLATFORM        default linux/arm64 (the VPS is a Hetzner cax11, which is Arm)
#
# The image is streamed over SSH and pushed to the registry on the VPS over
# loopback (127.0.0.1:5000). Pushing through registry.hteker.com does not work:
# the node_modules layer is larger than Cloudflare's 100 MB request limit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-api-readfyi-com}"
PLATFORM="${PLATFORM:-linux/arm64}"
REGISTRY_HOST="registry.hteker.com"

: "${NPM_TOKEN:?NPM_TOKEN must be set (GitHub Packages token for @teker-holdings-bv packages)}"
: "${VPS_SSH:?VPS_SSH must be set to deploy@<server-ip> (vps-iac: terraform -chdir=terraform output -raw ssh_command)}"

if [ "$#" -ge 1 ]; then
  TAG="$1"
else
  TAG="$(date -u +%Y%m%d%H%M)-$(git -C "$ROOT" rev-parse --short HEAD)"
  if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
    TAG="${TAG}-dirty"
  fi
fi

if [ "$TAG" = "latest" ] || ! [[ "$TAG" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "invalid tag '$TAG': use an explicit tag (letters, digits, . _ -), never 'latest'" >&2
  exit 2
fi

LOCAL_REF="${IMAGE_NAME}:${TAG}"
REMOTE_REF="127.0.0.1:5000/${IMAGE_NAME}:${TAG}"

echo "==> Building packages/shared (copied into the image)"
npm run build -w packages/shared --prefix "$ROOT"

echo "==> Building ${LOCAL_REF} (${PLATFORM})"
docker buildx build \
  --platform "$PLATFORM" \
  --secret id=npm_token,env=NPM_TOKEN \
  --file "$ROOT/packages/api/Dockerfile" \
  --tag "$LOCAL_REF" \
  --load \
  "$ROOT"

echo "==> Streaming ${LOCAL_REF} to ${VPS_SSH}"
docker save "$LOCAL_REF" | ssh "$VPS_SSH" docker load

echo "==> Pushing to the VPS registry"
# The deploy user is logged in to 127.0.0.1:5000 by vps-iac's deploy.sh.
# Client-side expansion is intended: the refs are baked into the remote command.
# shellcheck disable=SC2029
ssh "$VPS_SSH" "docker tag '${LOCAL_REF}' '${REMOTE_REF}' \
  && docker push '${REMOTE_REF}' \
  && docker rmi '${REMOTE_REF}' '${LOCAL_REF}' >/dev/null"

echo
echo "Published ${REGISTRY_HOST}/${IMAGE_NAME}:${TAG}"
echo "Next: set it as the api-readfyi-com image in vps-iac terraform/apps.auto.tfvars and run terraform apply."
