# ================================
# Build stage
# ================================
FROM node:20-alpine AS builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/. .

RUN npm run build


# ================================
# Production stage
# ================================
FROM nginx:alpine AS production

# Instala gettext para envsubst
RUN apk add --no-cache gettext

COPY --from=builder /app/frontend/dist /usr/share/nginx/html

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

COPY frontend/api-proxy.conf.template /etc/nginx/api-proxy.conf.template

RUN printf '#!/bin/sh\nset -eu\n\n: "${VITE_API_BASE_URL:?Set VITE_API_BASE_URL in the EasyPanel service environment}"\nmkdir -p /etc/nginx/snippets\nenvsubst '\''${VITE_API_BASE_URL}'\'' < /etc/nginx/api-proxy.conf.template > /etc/nginx/snippets/api-proxy.conf\n' > /docker-entrypoint.d/40-runtime-env.sh

RUN chmod +x /docker-entrypoint.d/40-runtime-env.sh

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]