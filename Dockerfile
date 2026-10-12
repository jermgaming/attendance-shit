# Stage 1: build the React frontend
FROM node:20-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: backend runtime serving the built frontend
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev
COPY backend/ ./
COPY --from=frontend /build/frontend/dist ./public
EXPOSE 3000
CMD ["node", "src/index.js"]
