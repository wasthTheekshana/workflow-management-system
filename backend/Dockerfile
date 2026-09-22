FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "npx knex migrate:latest && node scripts/seed.js && node src/server.js"]
