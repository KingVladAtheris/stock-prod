# stock-prod

A full-stack accounting/stock application built with **React + TypeScript** (frontend), **FastAPI + Python** (backend), and **PostgreSQL** — all containerized with Docker.

---

## Architecture

```
Browser → nginx:80
              ├── /          → React SPA (static files, client-side routing)
              └── /api/      → FastAPI backend (port 8000, internal only)
                                  └── PostgreSQL (port 5432, internal only)
```

The nginx container serves the React build and proxies all `/api/` requests to the FastAPI backend. The database and backend are never directly exposed to the host.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v24+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2+)

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/KingVladAtheris/stock-prod.git
cd stock-prod
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and set real values:

```env
# Required
POSTGRES_PASSWORD=change_this_to_a_strong_password_please

# Required — generate a secure key with:
# python -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY=supersecretkeychangethisinproduction

DEBUG=False
```

> ⚠️ `SECRET_KEY` is used to sign JWT tokens. Use a long random string in production.  
> ⚠️ **Never commit `.env` to version control.** It is already in `.gitignore`.

### 3. Build and start

```bash
docker compose up -d --build
```

On first start the backend will:
1. Wait for PostgreSQL to be ready
2. Run Alembic database migrations automatically
3. Start the FastAPI server

The app will be available at **`http://localhost`** (or `http://<server-ip>` if on a remote machine).

### 4. Stop

```bash
docker compose down
```

To also wipe the database volume (⚠️ destroys all data):

```bash
docker compose down -v
```

---

## Accessing the App Without a Domain

During beta testing, access the app directly by IP — no domain name required:

- **Local machine:** `http://localhost`
- **Remote server:** `http://<server-ip>` (e.g. `http://192.168.1.50`)

The React frontend calls all backend endpoints under `/api/`, which nginx proxies internally. Everything works over plain HTTP by IP.

---

## Authentication

The app uses **JWT Bearer tokens** with a 24-hour expiry. Tokens are stored in `localStorage` by the frontend. On expiry or invalid token, the user is automatically redirected to the login screen.

User accounts are created via the `/api/auth/register` endpoint (or the Register page in the UI).

---

## Database Backups

PostgreSQL data lives in `./data/postgres/` on the host. **Back this up regularly.**

### Option A — pg_dump (recommended)

Creates a consistent SQL snapshot while the database is running:

```bash
docker exec stock-db pg_dump -U postgres accounting > backup_$(date +%Y%m%d_%H%M%S).sql
```

**Restore from a dump:**

```bash
docker exec -i stock-db psql -U postgres accounting < backup_20240101_120000.sql
```

### Option B — Cold file copy

Stops the database first to avoid data corruption:

```bash
docker compose stop db
cp -r ./data/postgres ./data/postgres_backup_$(date +%Y%m%d)
docker compose start db
```

### Automating with cron (Linux)

Create a `backups/` directory first:

```bash
mkdir -p backups
```

Then add this to your crontab (`crontab -e`) to back up daily at 2 AM:

```cron
0 2 * * * cd /path/to/stock-prod && docker exec stock-db pg_dump -U postgres accounting > ./backups/backup_$(date +\%Y\%m\%d).sql
```

> Consider periodically copying backups off the server (e.g. external drive, S3, rsync to another machine).

---

## Logs

```bash
# All services
docker compose logs -f

# Individual services
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f db
```

---

## Updating

After pulling new code:

```bash
git pull
docker compose up -d --build
```

Alembic migrations run automatically on backend startup — no manual migration step needed.

---

## API Overview

All frontend API calls go through `/api/`. Key endpoint groups:

| Prefix | Description |
|---|---|
| `/api/auth/` | Register, login, get current user |
| `/api/companies/` | Company management, ledger open/close |
| `/api/counterparties/` | Suppliers / counterparties |
| `/api/companies/{id}/products/` | Products per company |
| `/api/companies/{id}/inventory/` | Current inventory |
| `/api/companies/{id}/days/{date}/` | Daily report, transactions, exits |
| `/api/companies/{id}/summary/` | Monthly and yearly summaries |

Interactive API docs (Swagger UI) are available at **`http://localhost/api/docs`** when the app is running.

---

## File Structure

```
stock-prod/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app entry point
│   │   ├── auth.py          # JWT auth logic
│   │   ├── models.py        # SQLAlchemy models
│   │   └── ...
│   ├── alembic/             # Database migrations
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/index.ts     # All API calls
│   │   └── ...
│   ├── nginx.conf           # nginx + reverse proxy config
│   └── Dockerfile
├── data/
│   └── postgres/            # DB data (auto-created, not committed)
├── backups/                 # SQL dumps (create manually, not committed)
├── docker-compose.yml
├── .env.example
└── .gitignore
```

---

## Troubleshooting

**Port 80 already in use:**
```bash
sudo lsof -i :80
# or change the exposed port in docker-compose.yml:
#   ports:
#     - "8080:80"
```

**Backend fails to start / migration errors:**
```bash
docker compose logs backend
# Common cause: DB not ready yet. The backend retries automatically,
# but you can also restart it manually:
docker compose restart backend
```

**Reset everything and start fresh:**
```bash
docker compose down -v   # ⚠️ deletes all database data
docker compose up -d --build
```

**Manually connect to the database:**
```bash
docker exec -it stock-db psql -U postgres -d accounting
```
