FROM python:3.11-slim

WORKDIR /app

# Install PostgreSQL client libs for psycopg2
RUN apt-get update && apt-get install -y \
    libpq-dev gcc postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Alembic migrations + start FastAPI
CMD ["sh", "-c", "echo 'Waiting for database to be ready...' && while ! pg_isready -h db -U postgres; do sleep 2; done && echo 'Database is ready. Running migrations...' && cd /app && PYTHONPATH=. alembic upgrade head && echo 'Starting FastAPI...' && uvicorn app.main:app --host 0.0.0.0 --port 8000"]