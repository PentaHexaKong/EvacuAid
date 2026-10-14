FROM node:24-slim AS dashboard
WORKDIR /build/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard ./
RUN npm run build

FROM python:3.14.7-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY server.py index.html ./
COPY --from=dashboard /build/command-center ./command-center
EXPOSE 8080
CMD ["python", "server.py"]
