FROM node:24.22.1-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8788
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY multiplayer/ ./multiplayer/
COPY public/ ./public/
RUN npm test

USER node
EXPOSE 8788
CMD ["node", "multiplayer/server.mjs"]
