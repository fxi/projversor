# The projversor apps served as static files by static-web-server: the explorer
# at /, the story at /story/, the minimal page at /minimal/
# and the comparisons at /compare/.

FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN npx vite build --config apps/explorer/vite.config.ts --base / \
 && npx vite build --config apps/story/vite.config.ts --base /story/ \
 && npx vite build --config apps/minimal/vite.config.ts --base /minimal/ \
 && npx vite build --config apps/compare/vite.config.ts --base /compare/

# static-web-server: a single memory-safe (Rust) binary on an empty base,
# run as "nobody". Config in docker/sws.toml.
FROM joseluisq/static-web-server:2
LABEL org.opencontainers.image.title="projversor" \
      org.opencontainers.image.description="Projversor apps: catalog data on a sphere that morphs between world projections" \
      org.opencontainers.image.source="https://github.com/fxi/projversor" \
      org.opencontainers.image.licenses="MIT"
COPY docker/sws.toml /sws.toml
COPY docker/healthz /public/healthz
COPY --from=build /src/dist-apps/explorer /public
COPY --from=build /src/dist-apps/story /public/story
COPY --from=build /src/dist-apps/minimal /public/minimal
COPY --from=build /src/dist-apps/compare /public/compare
USER 65534:65534
EXPOSE 8080
CMD ["--config-file", "/sws.toml"]
