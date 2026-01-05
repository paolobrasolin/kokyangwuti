FROM node:20-slim

USER root
RUN apt-get update && \
  apt-get install -y git sudo curl && \
  echo "node ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/node && \
  # This will now download the ARM64 binary of opencode-ai
  npm install -g pnpm opencode-ai && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

USER node
