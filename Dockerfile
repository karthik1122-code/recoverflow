FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs core.mjs webhook.mjs audit.mjs idempotency.mjs messages.mjs store.mjs pg-store.mjs auth.mjs ./
COPY public ./public
ENV NODE_ENV=production
EXPOSE 4173
CMD ["node", "server.mjs"]
