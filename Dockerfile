FROM node:20-bookworm-slim

# Install system dependencies: python3, ffmpeg, curl, unzip, ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    curl \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Deno for yt-dlp JavaScript challenge solver
RUN curl -fsSL https://deno.land/install.sh | sh \
    && mv /root/.deno/bin/deno /usr/local/bin/deno

# Install latest standalone yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Set working directory
WORKDIR /app

# Copy package manifests first for efficient docker layer caching
COPY package*.json ./

# Install npm dependencies
RUN npm install --omit=dev

# Copy application source
COPY . .

# Ensure downloads directory exists
RUN mkdir -p downloads

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV YTDLP_PATH=yt-dlp

EXPOSE 3000

# Start server
CMD ["node", "server.js"]
