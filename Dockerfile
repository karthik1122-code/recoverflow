FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs core.mjs webhook.mjs audit.mjs idempotency.mjs messages.mjs ./
COPY public ./public
ENV NODE_ENV=production
EXPOSE 4173
CMD ["node", "server.mjs"]
