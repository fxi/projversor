# The projversor apps served as static files by nginx: the explorer at /,
# the story at /story/, the site at /site/ and the minimal page at /minimal/.

FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN npx vite build --config apps/explorer/vite.config.ts --base / \
 && npx vite build --config apps/story/vite.config.ts --base /story/ \
 && npx vite build --config apps/site/vite.config.ts \
 && npx vite build --config apps/minimal/vite.config.ts --base /minimal/

FROM nginxinc/nginx-unprivileged:alpine-slim
LABEL org.opencontainers.image.title="projversor" \
      org.opencontainers.image.description="Projversor apps: catalog data on a sphere that morphs between world projections" \
      org.opencontainers.image.source="https://github.com/fxi/projversor" \
      org.opencontainers.image.licenses="MIT"
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist-apps/explorer /usr/share/nginx/html
COPY --from=build /src/dist-apps/story /usr/share/nginx/html/story
COPY --from=build /src/dist-apps/site /usr/share/nginx/html/site
COPY --from=build /src/dist-apps/minimal /usr/share/nginx/html/minimal
EXPOSE 8080
