# The projversor apps served as static files by nginx: the explorer at /,
# the story at /story/, the minimal page at /minimal/
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

# Official nginx image, run as its unprivileged "nginx" user (see docker/nginx.conf).
# Not nginxinc/nginx-unprivileged: its rebuilds lag behind nginx security releases.
FROM nginx:1.31-alpine-slim
USER nginx
LABEL org.opencontainers.image.title="projversor" \
      org.opencontainers.image.description="Projversor apps: catalog data on a sphere that morphs between world projections" \
      org.opencontainers.image.source="https://github.com/fxi/projversor" \
      org.opencontainers.image.licenses="MIT"
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /src/dist-apps/explorer /usr/share/nginx/html
COPY --from=build /src/dist-apps/story /usr/share/nginx/html/story
COPY --from=build /src/dist-apps/minimal /usr/share/nginx/html/minimal
COPY --from=build /src/dist-apps/compare /usr/share/nginx/html/compare
EXPOSE 8080
