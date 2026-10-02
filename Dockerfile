FROM node:22-bookworm-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# Official script installers (e.g. Antigravity CLI) drop binaries in ~/.local/bin
# npm global packages install to user-writable NPM_CONFIG_PREFIX
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PATH=/home/node/.local/bin:/home/node/.npm-global/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates git curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --break-system-packages -r requirements.txt
COPY app ./app
COPY docs ./docs
COPY LICENSE README.md .env.example ./
RUN mkdir -p /app/data /app/storage/harnesses /app/storage/uploads \
    /home/node/.local/bin /home/node/.npm-global /home/node/.npm \
    && echo "prefix=/home/node/.npm-global" > /home/node/.npmrc \
    && echo "export NPM_CONFIG_PREFIX=/home/node/.npm-global" >> /home/node/.profile \
    && echo "export PATH=\"/home/node/.local/bin:/home/node/.npm-global/bin:\$PATH\"" >> /home/node/.profile \
    && echo "export NPM_CONFIG_PREFIX=/home/node/.npm-global" >> /home/node/.bashrc \
    && echo "export PATH=\"/home/node/.local/bin:/home/node/.npm-global/bin:\$PATH\"" >> /home/node/.bashrc \
    && chown -R node:node /app /home/node
USER node
EXPOSE 3500
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -fsS http://127.0.0.1:3500/health || exit 1
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3500"]
