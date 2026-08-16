import axios from "axios";

const openLibrary = axios.create({
  baseURL: "https://openlibrary.org",
  timeout: 5000,
  headers: {
    Accept: "application/json",
    "User-Agent": "BookNotesPortfolio/1.0 (educational DevOps project)",
  },
});

export function normalizeIsbn(value = "") {
  return String(value).replace(/[\s-]/g, "").toUpperCase();
}

export function isValidIsbn(isbn) {
  return /^(?:\d{13}|\d{9}[\dX])$/.test(normalizeIsbn(isbn));
}

export async function findBookByIsbn(value) {
  const isbn = normalizeIsbn(value);

  if (!isValidIsbn(isbn)) {
    return null;
  }

  const response = await openLibrary.get("/search.json", {
    params: {
      isbn,
      fields: "key,title,author_name,cover_i",
      limit: 1,
    },
  });
  const result = response.data.docs?.[0];

  if (!result) {
    return null;
  }

  return {
    isbn,
    title: result.title || "",
    author: result.author_name?.[0] || "Unknown author",
    coverUrl: result.cover_i
      ? `https://covers.openlibrary.org/b/id/${result.cover_i}-L.jpg`
      : null,
    openLibraryUrl: result.key
      ? `https://openlibrary.org${result.key}`
      : `https://openlibrary.org/isbn/${isbn}`,
  };
}
