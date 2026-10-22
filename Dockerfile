# The projversor demos served as static files by nginx: the explorer at /,
# the story at /story/, the site at /site/ and the minimal page at /minimal/.
#
# projversor depends on zartigl as a sibling (file:../zartigl): the build
# context is the folder holding both repositories, e.g. from that folder:
#   docker build -f projversor/Dockerfile .
# Dockerfile.dockerignore keeps the context to these two repositories.

FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
COPY zartigl/package.json zartigl/package-lock.json zartigl/
COPY projversor/package.json projversor/package-lock.json projversor/
RUN npm ci --prefix zartigl --no-audit --no-fund --ignore-scripts \
 && npm ci --prefix projversor --no-audit --no-fund --ignore-scripts
COPY zartigl zartigl
RUN npm run --prefix zartigl build:lib
COPY projversor projversor
WORKDIR /src/projversor
RUN npx vite build --config vite.config.projection.ts --base / \
 && npx vite build --config vite.config.story.ts --base /story/ \
 && npx vite build --config vite.config.site.ts \
 && npx vite build --config vite.config.minimal.ts --base /minimal/

FROM nginxinc/nginx-unprivileged:alpine-slim
LABEL org.opencontainers.image.title="projversor" \
      org.opencontainers.image.description="Projversor demos: catalog data on a sphere that morphs between world projections" \
      org.opencontainers.image.source="https://github.com/fxi/projversor" \
      org.opencontainers.image.licenses="MIT"
COPY projversor/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/projversor/dist-projection /usr/share/nginx/html
COPY --from=build /src/projversor/dist-story /usr/share/nginx/html/story
COPY --from=build /src/projversor/dist-site /usr/share/nginx/html/site
COPY --from=build /src/projversor/dist-minimal /usr/share/nginx/html/minimal
EXPOSE 8080
