FROM node:20-slim

# Install Python 3 + pip for yt-dlp
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN pip3 install yt-dlp --break-system-packages

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm install --production

# Copy app source
COPY . .

# Create downloads folder
RUN mkdir -p downloads

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "app.js"]
