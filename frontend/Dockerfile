FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN CONTAINER_BUILD=1 npm run build \
    && cp -r .next/static .next/standalone/.next/ \
    && if [ -d public ]; then cp -r public .next/standalone/; fi

FROM node:22.22.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
USER node
CMD ["node", "server.js"]
