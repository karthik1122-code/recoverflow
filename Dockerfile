FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY *.mjs ./
RUN rm -f *.test.mjs eval-cases.mjs evaluate.mjs evaluate-hard.mjs
COPY public ./public
ENV NODE_ENV=production
EXPOSE 4173
CMD ["node", "server.mjs"]
