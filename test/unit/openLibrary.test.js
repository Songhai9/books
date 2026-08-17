import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findBookByIsbn,
  isValidIsbn,
  normalizeIsbn,
} from "../../services/openLibrary.js";

describe("Open Library helpers", () => {
  it("normalizes spaces, hyphens, and the ISBN-10 X character", () => {
    assert.equal(normalizeIsbn(" 0-8044-2957-x "), "080442957X");
    assert.equal(normalizeIsbn("978-0-7352-1129-2"), "9780735211292");
  });

  it("accepts ISBN-10 and ISBN-13 formats and rejects other input", () => {
    assert.equal(isValidIsbn("080442957X"), true);
    assert.equal(isValidIsbn("9780735211292"), true);
    assert.equal(isValidIsbn("1234"), false);
    assert.equal(isValidIsbn("not-an-isbn"), false);
  });

  it("does not call Open Library for an invalid ISBN", async () => {
    let called = false;
    const fakeClient = {
      async get() {
        called = true;
      },
    };

    assert.equal(await findBookByIsbn("invalid", fakeClient), null);
    assert.equal(called, false);
  });

  it("maps a successful search response into the application format", async () => {
    const fakeClient = {
      async get(path, options) {
        assert.equal(path, "/search.json");
        assert.equal(options.params.isbn, "9780735211292");

        return {
          data: {
            docs: [
              {
                key: "/works/OL123W",
                title: "Atomic Habits",
                author_name: ["James Clear"],
                cover_i: 12345,
              },
            ],
          },
        };
      },
    };

    assert.deepEqual(await findBookByIsbn("9780735211292", fakeClient), {
      isbn: "9780735211292",
      title: "Atomic Habits",
      author: "James Clear",
      coverUrl: "https://covers.openlibrary.org/b/id/12345-L.jpg",
      openLibraryUrl: "https://openlibrary.org/works/OL123W",
    });
  });

  it("handles missing results and incomplete metadata", async () => {
    const noResultsClient = {
      async get() {
        return { data: { docs: [] } };
      },
    };
    const incompleteResultClient = {
      async get() {
        return { data: { docs: [{ title: "A Book" }] } };
      },
    };

    assert.equal(
      await findBookByIsbn("9780735211292", noResultsClient),
      null,
    );
    assert.deepEqual(
      await findBookByIsbn("9780735211292", incompleteResultClient),
      {
        isbn: "9780735211292",
        title: "A Book",
        author: "Unknown author",
        coverUrl: null,
        openLibraryUrl: "https://openlibrary.org/isbn/9780735211292",
      },
    );
  });

  it("propagates API failures for the route to handle", async () => {
    const failingClient = {
      async get() {
        throw new Error("timeout");
      },
    };

    await assert.rejects(
      findBookByIsbn("9780735211292", failingClient),
      /timeout/,
    );
  });
});
