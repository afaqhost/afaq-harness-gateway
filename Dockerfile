# ---- builder ----
FROM node:24-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime ----
FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

ENV AHG_HOST=0.0.0.0
ENV AHG_PORT=3000
ENV AHG_DATA_DIR=/data

VOLUME /data
EXPOSE 3000

CMD ["node", "dist/src/start.js"]
