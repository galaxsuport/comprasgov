# ================================
# Build stage
# ================================
FROM node:22-alpine AS builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/index.html ./
COPY frontend/vite.config.ts ./
COPY frontend/tsconfig*.json ./
COPY frontend/src ./src

RUN npm run build


FROM node:22-alpine AS api-dependencies

WORKDIR /app/server

RUN apk add --no-cache python3 make g++
COPY server/package*.json ./
RUN npm ci --omit=dev


# ================================
# Production stage
# ================================
FROM node:22-alpine AS production

ENV NODE_ENV=production
ENV PORT=80
ENV DATA_DIR=/data

WORKDIR /app

RUN apk add --no-cache libstdc++
COPY server/index.js server/app.js server/default-terms.js ./server/
COPY --from=api-dependencies /app/server/node_modules ./server/node_modules
COPY --from=builder /app/frontend/dist ./frontend/dist

VOLUME ["/data"]
EXPOSE 80

CMD ["node", "server/index.js"]