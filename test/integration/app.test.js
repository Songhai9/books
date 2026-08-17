import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { db } from "../../db.js";
import { app } from "../../index.js";

const databaseName = process.env.DATABASE_NAME || "";

if (!databaseName.endsWith("_test")) {
  throw new Error(
    `Integration tests require an isolated database ending in _test; received "${databaseName}".`,
  );
}

async function resetDatabase() {
  await db.query(
    "TRUNCATE TABLE reader_books, books, readers RESTART IDENTITY CASCADE",
  );
}

async function createReader(name = "Oumar", color = "#7b4a2d") {
  const result = await db.query(
    "INSERT INTO readers (name, color) VALUES ($1, $2) RETURNING id",
    [name, color],
  );
  return result.rows[0].id;
}

async function createBook(values = {}) {
  const result = await db.query(
    `INSERT INTO books (title, author, isbn, cover_url)
     VALUES ($1, $2, $3, NULL)
     RETURNING id`,
    [
      values.title || "Deep Work",
      values.author || "Cal Newport",
      values.isbn || "9781455586691",
    ],
  );
  return result.rows[0].id;
}

async function createSharedBook() {
  return createBook();
}

async function createEntry(readerId, bookId, values = {}) {
  const result = await db.query(
    `INSERT INTO reader_books (reader_id, book_id, rating, date_read, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      readerId,
      bookId,
      values.rating || 8,
      values.dateRead || "2025-02-10",
      values.notes || "Focused work requires deliberate practice.",
    ],
  );
  return result.rows[0].id;
}

before(async () => {
  const schema = await readFile(
    new URL("../../sql/schema.sql", import.meta.url),
    "utf8",
  );
  await db.query(schema);
});

beforeEach(resetDatabase);
after(async () => db.end());

describe("health endpoints", () => {
  it("reports application and database readiness", async () => {
    const health = await request(app).get("/health");
    const ready = await request(app).get("/ready");

    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: "ok", service: "book-notes" });
    assert.equal(ready.status, 200);
    assert.equal(ready.body.database, "connected");
  });
});

describe("reader profiles", () => {
  it("creates a reader and rejects a duplicate name", async () => {
    const created = await request(app)
      .post("/readers")
      .type("form")
      .send({ name: "Oumar", color: "#7b4a2d" });
    const duplicate = await request(app)
      .post("/readers")
      .type("form")
      .send({ name: "Oumar", color: "#315f72" });

    assert.equal(created.status, 302);
    assert.equal(created.headers.location, "/?reader=1");
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.text, /already exists/);
  });

  it("renders the empty state and validates new reader input", async () => {
    const emptyLibrary = await request(app).get("/");
    const newReaderForm = await request(app).get("/readers/new");
    const invalidReader = await request(app)
      .post("/readers")
      .type("form")
      .send({ name: "", color: "red" });

    assert.equal(emptyLibrary.status, 200);
    assert.match(emptyLibrary.text, /Create your first reader/);
    assert.equal(newReaderForm.status, 200);
    assert.match(newReaderForm.text, /Add a reader/);
    assert.equal(invalidReader.status, 400);
    assert.match(invalidReader.text, /valid profile color/);
  });
});

describe("request validation", () => {
  it("rejects invalid ISBNs and unknown readers", async () => {
    const invalidIsbn = await request(app).get(
      "/api/books/isbn/not-an-isbn",
    );
    const unknownReader = await request(app).get("/books/new?reader=9999");

    assert.equal(invalidIsbn.status, 400);
    assert.match(invalidIsbn.body.error, /ISBN/);
    assert.equal(unknownReader.status, 404);
    assert.match(unknownReader.text, /Reader not found/);
  });

  it("renders the add-book form and rejects incomplete book data", async () => {
    const readerId = await createReader();
    const form = await request(app).get(`/books/new?reader=${readerId}`);
    const invalidBook = await request(app)
      .post("/books")
      .type("form")
      .send({
        readerId,
        isbn: "invalid",
        title: "",
        author: "",
        rating: 11,
        dateRead: "",
        notes: "",
      });

    assert.equal(form.status, 200);
    assert.match(form.text, /Look up book/);
    assert.equal(invalidBook.status, 400);
    assert.match(invalidBook.text, /Complete every field/);
  });

  it("returns the application 404 page for an unknown route", async () => {
    const response = await request(app).get("/does-not-exist");

    assert.equal(response.status, 404);
    assert.match(response.text, /Page not found/);
  });
});

describe("reader book entries", () => {
  it("adds a book and keeps the entry scoped to its reader", async () => {
    const oumarId = await createReader("Oumar");
    const kanaId = await createReader("Kana", "#315f72");

    const response = await request(app)
      .post("/books")
      .type("form")
      .send({
        readerId: oumarId,
        isbn: "978-0-7352-1129-2",
        title: "Atomic Habits",
        author: "James Clear",
        coverUrl: "https://example.com/untrusted.jpg",
        rating: 9,
        dateRead: "2025-01-15",
        notes: "Small improvements compound.",
      });

    assert.equal(response.status, 302);

    const stored = await db.query(
      `SELECT books.isbn, books.cover_url, reader_books.reader_id,
              reader_books.rating, reader_books.notes
       FROM reader_books
       JOIN books ON books.id = reader_books.book_id`,
    );
    assert.deepEqual(stored.rows, [
      {
        isbn: "9780735211292",
        cover_url: null,
        reader_id: oumarId,
        rating: 9,
        notes: "Small improvements compound.",
      },
    ]);

    const oumarLibrary = await request(app).get(`/?reader=${oumarId}`);
    const kanaLibrary = await request(app).get(`/?reader=${kanaId}`);
    assert.match(oumarLibrary.text, /Atomic Habits/);
    assert.doesNotMatch(kanaLibrary.text, /Atomic Habits/);
  });

  it("rejects a duplicate reader-book relationship and rolls back", async () => {
    const readerId = await createReader();
    const form = {
      readerId,
      isbn: "9781455586691",
      title: "Deep Work",
      author: "Cal Newport",
      coverUrl: "",
      rating: 8,
      dateRead: "2025-02-10",
      notes: "First entry.",
    };

    assert.equal(
      (await request(app).post("/books").type("form").send(form)).status,
      302,
    );
    const duplicate = await request(app)
      .post("/books")
      .type("form")
      .send({ ...form, rating: 4, notes: "Duplicate." });

    assert.equal(duplicate.status, 409);
    assert.match(duplicate.text, /already recorded/);

    const result = await db.query(
      "SELECT rating, notes FROM reader_books",
    );
    assert.deepEqual(result.rows, [{ rating: 8, notes: "First entry." }]);
  });

  it("updates only the reader's personal fields", async () => {
    const readerId = await createReader();
    const bookId = await createSharedBook();
    const entryId = await createEntry(readerId, bookId);

    const response = await request(app)
      .post(`/readers/${readerId}/books/${entryId}/update`)
      .type("form")
      .send({
        rating: 10,
        dateRead: "2025-03-12",
        notes: "Updated personal notes.",
      });

    assert.equal(response.status, 302);

    const result = await db.query(
      `SELECT books.title, books.author, reader_books.rating,
              TO_CHAR(reader_books.date_read, 'YYYY-MM-DD') AS date_read,
              reader_books.notes
       FROM reader_books
       JOIN books ON books.id = reader_books.book_id`,
    );
    assert.deepEqual(result.rows, [
      {
        title: "Deep Work",
        author: "Cal Newport",
        rating: 10,
        date_read: "2025-03-12",
        notes: "Updated personal notes.",
      },
    ]);
  });

  it("preserves exact DATE values in rendered HTML", async () => {
    const readerId = await createReader();
    const bookId = await createSharedBook();
    const entryId = await createEntry(readerId, bookId, {
      dateRead: "2025-01-15",
    });

    const response = await request(app).get(
      `/readers/${readerId}/books/${entryId}`,
    );

    assert.equal(response.status, 200);
    assert.match(response.text, /datetime="2025-01-15"/);

    const editForm = await request(app).get(
      `/readers/${readerId}/books/${entryId}/edit`,
    );
    assert.equal(editForm.status, 200);
    assert.match(editForm.text, /value="2025-01-15"/);
  });

  it("rejects invalid updates and reader-entry mismatches", async () => {
    const oumarId = await createReader("Oumar");
    const kanaId = await createReader("Kana", "#315f72");
    const bookId = await createSharedBook();
    const entryId = await createEntry(oumarId, bookId);

    const invalidUpdate = await request(app)
      .post(`/readers/${oumarId}/books/${entryId}/update`)
      .type("form")
      .send({ rating: 0, dateRead: "", notes: "" });
    const mismatchedDetail = await request(app).get(
      `/readers/${kanaId}/books/${entryId}`,
    );
    const missingDelete = await request(app).post(
      `/readers/${kanaId}/books/${entryId}/delete`,
    );

    assert.equal(invalidUpdate.status, 400);
    assert.match(invalidUpdate.text, /rating between 1 and 10/);
    assert.equal(mismatchedDetail.status, 404);
    assert.equal(missingDelete.status, 404);

    const unchanged = await db.query(
      "SELECT rating, notes FROM reader_books WHERE id = $1",
      [entryId],
    );
    assert.deepEqual(unchanged.rows, [
      {
        rating: 8,
        notes: "Focused work requires deliberate practice.",
      },
    ]);
  });

  it("sorts a reader's books by title, rating, and recency", async () => {
    const readerId = await createReader();
    const alphaId = await createBook({
      title: "Alpha",
      isbn: "9780000000001",
    });
    const betaId = await createBook({
      title: "Beta",
      isbn: "9780000000002",
    });
    const zetaId = await createBook({
      title: "Zeta",
      isbn: "9780000000003",
    });
    await createEntry(readerId, alphaId, {
      rating: 5,
      dateRead: "2025-01-01",
    });
    await createEntry(readerId, betaId, {
      rating: 10,
      dateRead: "2025-02-01",
    });
    await createEntry(readerId, zetaId, {
      rating: 7,
      dateRead: "2025-03-01",
    });

    const byTitle = (
      await request(app).get(`/?reader=${readerId}&sort=title`)
    ).text;
    const byRating = (
      await request(app).get(`/?reader=${readerId}&sort=rating`)
    ).text;
    const byRecent = (
      await request(app).get(`/?reader=${readerId}&sort=unknown`)
    ).text;

    assert.ok(byTitle.indexOf("Alpha") < byTitle.indexOf("Beta"));
    assert.ok(byTitle.indexOf("Beta") < byTitle.indexOf("Zeta"));
    assert.ok(byRating.indexOf("Beta") < byRating.indexOf("Zeta"));
    assert.ok(byRating.indexOf("Zeta") < byRating.indexOf("Alpha"));
    assert.ok(byRecent.indexOf("Zeta") < byRecent.indexOf("Beta"));
    assert.ok(byRecent.indexOf("Beta") < byRecent.indexOf("Alpha"));
  });

  it("deletes only the requested relationship and then removes an orphan", async () => {
    const oumarId = await createReader("Oumar");
    const kanaId = await createReader("Kana", "#315f72");
    const bookId = await createSharedBook();
    const oumarEntryId = await createEntry(oumarId, bookId);
    const kanaEntryId = await createEntry(kanaId, bookId, { rating: 7 });

    assert.equal(
      (
        await request(app).post(
          `/readers/${oumarId}/books/${oumarEntryId}/delete`,
        )
      ).status,
      302,
    );
    assert.equal(
      Number((await db.query("SELECT COUNT(*) FROM books")).rows[0].count),
      1,
    );
    assert.equal(
      Number(
        (await db.query("SELECT COUNT(*) FROM reader_books")).rows[0].count,
      ),
      1,
    );

    await request(app).post(
      `/readers/${kanaId}/books/${kanaEntryId}/delete`,
    );
    assert.equal(
      Number((await db.query("SELECT COUNT(*) FROM books")).rows[0].count),
      0,
    );
  });
});
