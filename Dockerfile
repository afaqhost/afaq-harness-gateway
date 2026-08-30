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
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3500"]
