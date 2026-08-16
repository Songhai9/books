# Book Notes

Book Notes is a small Express and PostgreSQL application where several readers
can record books, ratings, reading dates, and personal notes. Reader selection
works like the Family Travel Tracker project and does not require authentication.
The application is intentionally simple so it can serve as the workload for an
end-to-end DevOps portfolio.

## Current status

Phase 2.5 provides reader selection, ISBN-based book creation through Open
Library, reader-specific book details, editing, and deletion.

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
