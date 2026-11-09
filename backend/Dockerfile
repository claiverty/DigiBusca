FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/src backend/src
RUN npm ci && npm run backend:build

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/backend/dist ./backend/dist
USER node

EXPOSE 3001
CMD ["node", "backend/dist/http/server.js"]
