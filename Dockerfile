
FROM node:18

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy project files
COPY . .

# Build TypeScript
RUN npm run build

# Build binaries
RUN npm run build:ncc && \
    pkg build/index.js --output dist/bin/griq-linux-amd64 --target node18-linux-x64 && \
    pkg build/index.js --output dist/bin/griq-linux-386 --target node18-linux-x86 && \
    pkg build/index.js --output dist/bin/griq-linux-arm --target node18-linux-arm && \
    pkg build/index.js --output dist/bin/griq-linux-arm64 --target node18-linux-arm64