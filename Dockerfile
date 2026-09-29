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

COPY --from=builder /app/frontend/dist /usr/share/nginx/html

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Template das variáveis de runtime
RUN cat > /usr/share/nginx/html/env.template.js <<'EOF'
window.__ENV__ = {
  VITE_API_BASE_URL: "${VITE_API_BASE_URL}"
};
EOF

# Gera env.js toda vez que o container iniciar
RUN cat > /docker-entrypoint.d/40-runtime-env.sh <<'EOF'
#!/bin/sh
set -eu

envsubst '${VITE_API_BASE_URL}' \
  < /usr/share/nginx/html/env.template.js \
  > /usr/share/nginx/html/env.js

echo "Runtime configuration generated."
EOF

RUN chmod +x /docker-entrypoint.d/40-runtime-env.sh

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]