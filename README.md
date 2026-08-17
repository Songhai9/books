# Book Notes

Book Notes is a small Express and PostgreSQL application where several readers
can record books, ratings, reading dates, and personal notes. Reader selection
works like the Family Travel Tracker project and does not require authentication.
The application is intentionally simple so it can serve as the workload for an
end-to-end DevOps portfolio.

## Current status

The application features are complete, the automated test suite is in place,
and a production multi-stage Docker image is available.

## Requirements

- Node.js
- PostgreSQL

## Local setup

1. Copy `.env.example` to `.env` and enter your local PostgreSQL settings.
2. Create a PostgreSQL database named `book_notes`.
3. Apply `sql/schema.sql` and, optionally, `sql/seed.sql`.
4. Install packages with `npm install`.
5. Start the application with `npm run dev`.

The website uses `http://localhost:3000` by default.

## Database model

- `readers` stores reader profiles and their display colors.
- `books` stores shared title, author, ISBN, and cover information.
- `reader_books` stores each reader's rating, reading date, and notes.

One book can therefore have different ratings and notes from different readers.

## Health endpoints

- `GET /health` confirms that the Express process is running.
- `GET /ready` confirms that the application can reach PostgreSQL.

## Main commands

```bash
npm run dev
npm start
```

## Tests

Fast unit tests do not require PostgreSQL:

```bash
npm run lint
npm run test:unit
```

The complete suite uses an isolated PostgreSQL database in Docker. It never
uses the local `book_notes` database configured in `.env`:

```bash
npm run test:container
npm run test:container:down
```

The containerized suite runs linting, unit tests, HTTP/database integration
tests, and code coverage. Integration tests also refuse to reset a database
unless its name ends in `_test`. The suite fails if coverage falls below 80%
for lines, 70% for branches, or 80% for functions.

## Production image

Build the production image locally:

```bash
npm run docker:build
```

The final image contains only production dependencies and application files.
It runs as the unprivileged `node` user and exposes a Docker health check on
`GET /health`. Database settings must be supplied through environment variables
when the container starts; `.env` is deliberately excluded from the image.

## Application stack with Docker Compose

Start the application and PostgreSQL together:

```bash
npm run compose:up
```

Open `http://localhost:3000`. Compose builds the production application image,
waits for PostgreSQL to become healthy, and initializes `sql/schema.sql` when
the database volume is created for the first time.

Stop the stack without deleting books:

```bash
npm run compose:down
```

Follow the container logs with `npm run compose:logs`. PostgreSQL is also
available to pgAdmin on `localhost:5433` with these local defaults:

- database: `book_notes`
- username: `book_notes`
- password: `book_notes_password`

These values and the published ports can be overridden with `POSTGRES_DB`,
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST_PORT`, and `APP_PORT`.
For a real deployment, provide a secret password instead of the local default.

The named `book-notes_postgres-data` volume keeps data between restarts. To
deliberately erase the Compose database and reapply the schema from scratch,
run `docker compose down --volumes`.

## Continuous integration

The GitHub Actions workflow in `.github/workflows/ci.yml` runs on every push,
pull request, and manual dispatch. It contains three jobs:

1. `quality` installs the locked dependencies, runs ESLint, and runs unit tests.
2. `integration` runs the complete test suite and coverage gates against an
   isolated PostgreSQL container.
3. `production-image` runs only after the first two jobs succeed. It builds the
   multi-stage image, starts it with PostgreSQL, and checks `/health` and
   `/ready`.

Both Compose environments are removed at the end of their jobs, including when
a preceding step fails. The workflow has read-only repository permissions and
does not publish or deploy anything yet.
