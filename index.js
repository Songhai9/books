import express from "express";
import { db } from "./db.js";
import {
  findBookByIsbn,
  isValidIsbn,
  normalizeIsbn,
} from "./services/openLibrary.js";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.set("view engine", "ejs");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const bookSorts = {
  rating: "reader_books.rating DESC, books.title ASC",
  recent: "reader_books.date_read DESC, books.title ASC",
  title: "books.title ASC",
};

async function getReader(readerId) {
  if (!Number.isInteger(readerId) || readerId < 1) {
    return null;
  }

  const result = await db.query(
    "SELECT id, name, color FROM readers WHERE id = $1",
    [readerId],
  );

  return result.rows[0] || null;
}

async function getReaderBookEntry(readerId, entryId) {
  if (
    !Number.isInteger(readerId) ||
    readerId < 1 ||
    !Number.isInteger(entryId) ||
    entryId < 1
  ) {
    return null;
  }

  const result = await db.query(
    `SELECT
      reader_books.id AS entry_id,
      reader_books.reader_id,
      reader_books.book_id,
      reader_books.rating,
      TO_CHAR(reader_books.date_read, 'YYYY-MM-DD') AS date_read_iso,
      TO_CHAR(reader_books.date_read, 'FMMonth DD, YYYY') AS date_read_label,
      reader_books.notes,
      books.title,
      books.author,
      books.isbn,
      books.cover_url,
      readers.name AS reader_name,
      readers.color AS reader_color
    FROM reader_books
    JOIN books ON books.id = reader_books.book_id
    JOIN readers ON readers.id = reader_books.reader_id
    WHERE reader_books.reader_id = $1 AND reader_books.id = $2`,
    [readerId, entryId],
  );

  return result.rows[0] || null;
}

function getBookFormValues(input = {}) {
  return {
    isbn: normalizeIsbn(input.isbn),
    title: input.title?.trim() || "",
    author: input.author?.trim() || "",
    coverUrl: input.coverUrl || "",
    rating: input.rating || "",
    dateRead: input.dateRead || "",
    notes: input.notes?.trim() || "",
  };
}

app.get("/", async (req, res, next) => {
  try {
    const readersResult = await db.query(
      "SELECT id, name, color FROM readers ORDER BY id",
    );
    const readers = readersResult.rows;

    if (readers.length === 0) {
      return res.render("index.ejs", {
        pageTitle: "Book Notes",
        readers: [],
        currentReader: null,
        books: [],
        currentSort: "recent",
      });
    }

    const requestedReaderId = Number.parseInt(req.query.reader, 10);
    const currentReader =
      readers.find((reader) => reader.id === requestedReaderId) || readers[0];
    const currentSort = Object.hasOwn(bookSorts, req.query.sort)
      ? req.query.sort
      : "recent";

    const booksResult = await db.query(
      `SELECT
        reader_books.id AS entry_id,
        books.id AS book_id,
        books.title,
        books.author,
        books.isbn,
        books.cover_url,
        reader_books.rating,
        TO_CHAR(reader_books.date_read, 'YYYY-MM-DD') AS date_read_iso,
        TO_CHAR(reader_books.date_read, 'FMMonth YYYY') AS date_read_label,
        reader_books.notes
      FROM reader_books
      JOIN books ON books.id = reader_books.book_id
      WHERE reader_books.reader_id = $1
      ORDER BY ${bookSorts[currentSort]}`,
      [currentReader.id],
    );

    res.render("index.ejs", {
      pageTitle: `${currentReader.name}'s Book Notes`,
      readers,
      currentReader,
      books: booksResult.rows,
      currentSort,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/readers/new", (req, res) => {
  res.render("new-reader.ejs", {
    pageTitle: "Add a reader",
    errorMessage: null,
    values: { name: "", color: "#7b4a2d" },
  });
});

app.post("/readers", async (req, res, next) => {
  const name = req.body.name?.trim();
  const color = req.body.color?.trim();
  const colorPattern = /^#[0-9A-Fa-f]{6}$/;

  if (!name || name.length > 80 || !colorPattern.test(color)) {
    return res.status(400).render("new-reader.ejs", {
      pageTitle: "Add a reader",
      errorMessage: "Enter a name and choose a valid profile color.",
      values: { name: name || "", color: color || "#7b4a2d" },
    });
  }

  try {
    const result = await db.query(
      "INSERT INTO readers (name, color) VALUES ($1, $2) RETURNING id",
      [name, color],
    );

    res.redirect(`/?reader=${result.rows[0].id}`);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).render("new-reader.ejs", {
        pageTitle: "Add a reader",
        errorMessage: "A reader with this name already exists.",
        values: { name, color },
      });
    }

    next(error);
  }
});

app.get("/api/books/isbn/:isbn", async (req, res, next) => {
  const isbn = normalizeIsbn(req.params.isbn);

  if (!isValidIsbn(isbn)) {
    return res.status(400).json({
      error: "Enter a valid ISBN-10 or ISBN-13.",
    });
  }

  try {
    const book = await findBookByIsbn(isbn);

    if (!book) {
      return res.status(404).json({
        error: "No book was found for this ISBN.",
      });
    }

    res.status(200).json(book);
  } catch (error) {
    console.error("Open Library lookup failed:", error.message);
    res.status(502).json({
      error: "Open Library is temporarily unavailable.",
    });
  }
});

app.get("/books/new", async (req, res, next) => {
  const readerId = Number.parseInt(req.query.reader, 10);
  const reader = await getReader(readerId);

  if (!reader) {
    return res.status(404).render("error.ejs", {
      pageTitle: "Reader not found",
      statusCode: 404,
      message: "Choose an existing reader before adding a book.",
    });
  }

  const isbn = normalizeIsbn(req.query.isbn);
  const values = getBookFormValues({ isbn });
  let lookupMessage = null;
  let lookupAttempted = Boolean(isbn);

  if (lookupAttempted && !isValidIsbn(isbn)) {
    lookupMessage = "Enter a valid ISBN-10 or ISBN-13.";
    lookupAttempted = false;
  } else if (lookupAttempted) {
    try {
      const book = await findBookByIsbn(isbn);

      if (book) {
        values.title = book.title;
        values.author = book.author;
        values.coverUrl = book.coverUrl || "";
      } else {
        lookupMessage =
          "Open Library did not find this ISBN. You can enter the book manually.";
      }
    } catch (error) {
      console.error("Open Library lookup failed:", error.message);
      lookupMessage =
        "Open Library is unavailable. You can still enter the book manually.";
    }
  }

  res.render("new-book.ejs", {
    pageTitle: `Add a book for ${reader.name}`,
    reader,
    lookupAttempted,
    lookupMessage,
    formError: null,
    values,
  });
});

app.post("/books", async (req, res, next) => {
  const readerId = Number.parseInt(req.body.readerId, 10);
  const reader = await getReader(readerId);

  if (!reader) {
    return res.status(404).render("error.ejs", {
      pageTitle: "Reader not found",
      statusCode: 404,
      message: "Choose an existing reader before adding a book.",
    });
  }

  const values = getBookFormValues(req.body);
  const rating = Number.parseInt(values.rating, 10);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(values.dateRead);
  const validCoverUrl = values.coverUrl.startsWith(
    "https://covers.openlibrary.org/",
  )
    ? values.coverUrl
    : null;

  if (
    !isValidIsbn(values.isbn) ||
    !values.title ||
    values.title.length > 200 ||
    !values.author ||
    values.author.length > 150 ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 10 ||
    !validDate ||
    !values.notes
  ) {
    return res.status(400).render("new-book.ejs", {
      pageTitle: `Add a book for ${reader.name}`,
      reader,
      lookupAttempted: true,
      lookupMessage: null,
      formError:
        "Complete every field and use a rating between 1 and 10.",
      values,
    });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const bookResult = await client.query(
      `INSERT INTO books (title, author, isbn, cover_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (isbn) DO UPDATE
       SET
         title = EXCLUDED.title,
         author = EXCLUDED.author,
         cover_url = COALESCE(EXCLUDED.cover_url, books.cover_url),
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [values.title, values.author, values.isbn, validCoverUrl],
    );

    await client.query(
      `INSERT INTO reader_books (reader_id, book_id, rating, date_read, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [reader.id, bookResult.rows[0].id, rating, values.dateRead, values.notes],
    );

    await client.query("COMMIT");
    res.redirect(`/?reader=${reader.id}&sort=recent`);
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      return res.status(409).render("new-book.ejs", {
        pageTitle: `Add a book for ${reader.name}`,
        reader,
        lookupAttempted: true,
        lookupMessage: null,
        formError: `${reader.name} has already recorded this book.`,
        values,
      });
    }

    next(error);
  } finally {
    client.release();
  }
});

app.get(
  "/readers/:readerId/books/:entryId",
  async (req, res, next) => {
    try {
      const readerId = Number.parseInt(req.params.readerId, 10);
      const entryId = Number.parseInt(req.params.entryId, 10);
      const entry = await getReaderBookEntry(readerId, entryId);

      if (!entry) {
        return res.status(404).render("error.ejs", {
          pageTitle: "Book entry not found",
          statusCode: 404,
          message: "This book is not recorded in the selected reader's library.",
        });
      }

      res.render("show-book.ejs", {
        pageTitle: `${entry.title} — ${entry.reader_name}`,
        entry,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/readers/:readerId/books/:entryId/edit",
  async (req, res, next) => {
    try {
      const readerId = Number.parseInt(req.params.readerId, 10);
      const entryId = Number.parseInt(req.params.entryId, 10);
      const entry = await getReaderBookEntry(readerId, entryId);

      if (!entry) {
        return res.status(404).render("error.ejs", {
          pageTitle: "Book entry not found",
          statusCode: 404,
          message: "This book is not recorded in the selected reader's library.",
        });
      }

      res.render("edit-book.ejs", {
        pageTitle: `Edit ${entry.title}`,
        entry,
        formError: null,
        values: {
          rating: entry.rating,
          dateRead: entry.date_read_iso,
          notes: entry.notes,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/readers/:readerId/books/:entryId/update",
  async (req, res, next) => {
    const readerId = Number.parseInt(req.params.readerId, 10);
    const entryId = Number.parseInt(req.params.entryId, 10);
    const entry = await getReaderBookEntry(readerId, entryId);

    if (!entry) {
      return res.status(404).render("error.ejs", {
        pageTitle: "Book entry not found",
        statusCode: 404,
        message: "This book is not recorded in the selected reader's library.",
      });
    }

    const rating = Number.parseInt(req.body.rating, 10);
    const dateRead = req.body.dateRead?.trim() || "";
    const notes = req.body.notes?.trim() || "";
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRead);

    if (
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 10 ||
      !validDate ||
      !notes
    ) {
      return res.status(400).render("edit-book.ejs", {
        pageTitle: `Edit ${entry.title}`,
        entry,
        formError:
          "Enter a rating between 1 and 10, a reading date, and your notes.",
        values: { rating: req.body.rating, dateRead, notes },
      });
    }

    try {
      await db.query(
        `UPDATE reader_books
         SET
           rating = $1,
           date_read = $2,
           notes = $3,
           updated_at = CURRENT_TIMESTAMP
         WHERE reader_id = $4 AND id = $5`,
        [rating, dateRead, notes, readerId, entryId],
      );

      res.redirect(`/readers/${readerId}/books/${entryId}`);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/readers/:readerId/books/:entryId/delete",
  async (req, res, next) => {
    const readerId = Number.parseInt(req.params.readerId, 10);
    const entryId = Number.parseInt(req.params.entryId, 10);
    const entry = await getReaderBookEntry(readerId, entryId);

    if (!entry) {
      return res.status(404).render("error.ejs", {
        pageTitle: "Book entry not found",
        statusCode: 404,
        message: "This book is not recorded in the selected reader's library.",
      });
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM reader_books WHERE reader_id = $1 AND id = $2",
        [readerId, entryId],
      );
      await client.query(
        `DELETE FROM books
         WHERE id = $1
           AND NOT EXISTS (
             SELECT 1 FROM reader_books WHERE book_id = $1
           )`,
        [entry.book_id],
      );
      await client.query("COMMIT");

      res.redirect(`/?reader=${readerId}`);
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "book-notes",
  });
});

app.get("/ready", async (req, res) => {
  try {
    await db.query("SELECT 1");

    res.status(200).json({
      status: "ready",
      database: "connected",
    });
  } catch (error) {
    console.error("PostgreSQL readiness check failed:", error.message);

    res.status(503).json({
      status: "not ready",
      database: "unavailable",
    });
  }
});

app.use((req, res) => {
  res.status(404).render("error.ejs", {
    pageTitle: "Page not found",
    statusCode: 404,
    message: "The page you requested does not exist.",
  });
});

app.use((error, req, res, next) => {
  console.error("Unexpected application error:", error);

  res.status(500).render("error.ejs", {
    pageTitle: "Application error",
    statusCode: 500,
    message: "Something went wrong. Please try again.",
  });
});

app.listen(port, (error) => {
  if (error) {
    console.error("Book Notes failed to start:", error.message);
    process.exitCode = 1;
    return;
  }

  console.log(`Book Notes is running on http://localhost:${port}`);
});
