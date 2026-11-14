FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    procps \
    curl \
    util-linux \
    && rm -rf /var/lib/apt/lists/*

# Install python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Run with dynamic PORT support
ENV PORT=5000
ENV PYTHONUNBUFFERED=1

EXPOSE 5000 5001 5002 5003

CMD ["python3", "app.py"]

