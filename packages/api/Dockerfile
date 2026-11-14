# syntax=docker/dockerfile:1.10
# Build from the repo root: docker build -f packages/api/Dockerfile .
# The GitHub Packages token is passed as a BuildKit secret (id=npm_token), so it
# never ends up in an image layer or in the image history.
FROM node:22-alpine AS build
WORKDIR /app
COPY .npmrc package*.json ./
COPY ./packages/api/package*.json ./packages/api/
COPY ./packages/shared/ ./packages/shared/
# packages/shared/dist must be built beforehand (scripts/publish-api.sh does this).
RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN npm install -w packages/api && rm -f .npmrc
COPY ./packages/api/ ./packages/api/
RUN npm run build -w packages/api

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY .npmrc package*.json ./
COPY ./packages/api/package*.json ./packages/api/
COPY --from=build /app/packages/shared/ ./packages/shared/
RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN npm install --omit=dev && rm -f .npmrc
COPY --from=build /app/packages/api/dist ./packages/api/dist

USER node
# Lets npm write its cache and logs when the root filesystem is read-only.
ENV npm_config_cache=/tmp/.npm
EXPOSE 3000
CMD ["sh", "-c", "npm run migration:run -w packages/api && npm run start:prod -w packages/api"]
