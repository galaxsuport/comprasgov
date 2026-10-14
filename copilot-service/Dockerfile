FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
RUN mkdir -p /home/node/.copilot && chown node:node /home/node/.copilot
COPY app.js index.js ./
ENV NODE_ENV=production
ENV PORT=8080
USER node
EXPOSE 8080
CMD ["node", "index.js"]
