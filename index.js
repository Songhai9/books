import express from "express";
import { db } from "./db.js";

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
