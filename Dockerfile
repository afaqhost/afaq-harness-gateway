FROM node:22-bookworm-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates git curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --break-system-packages -r requirements.txt
COPY app ./app
COPY docs ./docs
COPY LICENSE README.md .env.example ./
RUN mkdir -p data storage/harnesses storage/uploads
EXPOSE 3500
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -fsS http://127.0.0.1:3500/health || exit 1
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "localhost", "--port", "3500"]
