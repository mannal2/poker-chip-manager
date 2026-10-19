FROM node:24-bookworm-slim AS build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
COPY shared/ /app/shared/

RUN npm run build

FROM nginx:stable-alpine

COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80