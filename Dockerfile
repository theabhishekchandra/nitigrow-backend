# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000

RUN apk add --no-cache curl tini \
 && addgroup -S nitigrow -g 10001 \
 && adduser -S nitigrow -G nitigrow -u 10001

WORKDIR /app
COPY --from=deps --chown=nitigrow:nitigrow /app/node_modules ./node_modules
COPY --chown=nitigrow:nitigrow package*.json ./
COPY --chown=nitigrow:nitigrow src ./src

USER nitigrow
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
