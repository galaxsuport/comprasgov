FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && apt-get clean
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
RUN mkdir -p /home/node/.copilot && chown node:node /home/node/.copilot && chmod 700 /home/node/.copilot
COPY app.js index.js ./
ENV NODE_ENV=production
ENV PORT=8080
ENV HOME=/home/node
USER node
EXPOSE 8080
CMD ["node", "index.js"]
