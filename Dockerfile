# Multi-stage build for Node.js API
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY . .

# Create cache directory (for filesystem cache)
RUN mkdir -p /app/cache && chown node:node /app/cache

# Expose port (default 3000, can be overridden via PORT env var)
EXPOSE 3000

# Health check (using node to call the health endpoint)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "import('http').then(m=>m.get('http://localhost:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1)))"

# Run the application
USER node
CMD ["node", "src/index.js"]
