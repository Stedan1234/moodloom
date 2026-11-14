# One image: builds the web app, then runs the API, which serves both.
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=web /app/frontend/dist /app/frontend/dist
# Uploads belong on a mounted volume; set UPLOADS_DIR to its path.
RUN mkdir -p /data/uploads && chown -R node:node /data /app
ENV UPLOADS_DIR=/data/uploads PORT=3001
USER node
EXPOSE 3001
# Applies any new schema, then starts. Both are safe to run on every boot.
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
