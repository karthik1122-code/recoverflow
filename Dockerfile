FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production
EXPOSE 4173
CMD ["node", "server.mjs"]
