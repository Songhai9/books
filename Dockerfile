FROM node:24-bookworm-slim AS production-dependencies

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force


FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000

LABEL org.opencontainers.image.source="https://github.com/Songhai9/books" \
      org.opencontainers.image.description="Simple Express and PostgreSQL book notes application" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node index.js db.js ./
COPY --chown=node:node services ./services
COPY --chown=node:node views ./views
COPY --chown=node:node public ./public

# npm is useful while building dependencies, but the application only needs
# the Node.js runtime in production. Removing it also removes its unused
# transitive packages from the attack surface of the final image.
RUN rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm \
    /usr/local/bin/npx

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "index.js"]
