FROM node:20-alpine

WORKDIR /app

# Install dependencies (only production deps)
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY src ./src

# Expose the API port
EXPOSE 3000

# Default command starts the API server
# Workers should set custom command like: ["node", "src/worker.js"]
CMD ["npm", "start"]
