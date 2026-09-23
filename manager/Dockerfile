# Manager image: the web UI. Needs the Docker socket and the sandboxes
# directory mounted, plus SANDBOXES_HOST_DIR with the host path of it.
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm typecheck

FROM node:24-alpine
ARG BUILD_SHA=dev
WORKDIR /app
ENV NODE_ENV=production PORT=8787 SANDBOXES_DATA_DIR=/sandboxes BUILD_SHA=$BUILD_SHA
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/public ./public
COPY src ./src
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/server.ts"]
