FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install ALL dependencies (including dev for build tools)
RUN npm ci

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --production

# Expose port
EXPOSE ${PORT:-5000}

# Start the server
ENV NODE_ENV=production
CMD ["node", "dist/index.cjs"]
