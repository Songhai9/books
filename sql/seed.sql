INSERT INTO readers (name, color)
VALUES
  ('Oumar', '#7b4a2d'),
  ('Kana', '#315f72')
ON CONFLICT (name) DO UPDATE
SET color = EXCLUDED.color;

INSERT INTO books (title, author, isbn, cover_url)
VALUES
  (
    'Atomic Habits',
    'James Clear',
    '9780735211292',
    'https://covers.openlibrary.org/b/isbn/9780735211292-L.jpg'
  ),
  (
    'Deep Work',
    'Cal Newport',
    '9781455586691',
    'https://covers.openlibrary.org/b/isbn/9781455586691-L.jpg'
  )
ON CONFLICT (isbn) DO UPDATE
SET
  title = EXCLUDED.title,
  author = EXCLUDED.author,
  cover_url = EXCLUDED.cover_url,
  updated_at = CURRENT_TIMESTAMP;

WITH entries (reader_name, isbn, rating, date_read, notes) AS (
  VALUES
    (
      'Oumar',
      '9780735211292',
      9,
      DATE '2025-01-15',
      'Small, repeatable improvements compound into meaningful long-term change.'
    ),
    (
      'Oumar',
      '9781455586691',
      8,
      DATE '2025-02-10',
      'Focused work is a valuable skill that improves with deliberate practice.'
    ),
    (
      'Kana',
      '9780735211292',
      7,
      DATE '2025-03-08',
      'The examples made it easier to understand how habits develop.'
    )
)
INSERT INTO reader_books (reader_id, book_id, rating, date_read, notes)
SELECT
  readers.id,
  books.id,
  entries.rating,
  entries.date_read,
  entries.notes
FROM entries
JOIN readers ON readers.name = entries.reader_name
JOIN books ON books.isbn = entries.isbn
ON CONFLICT (reader_id, book_id) DO UPDATE
SET
  rating = EXCLUDED.rating,
  date_read = EXCLUDED.date_read,
  notes = EXCLUDED.notes,
  updated_at = CURRENT_TIMESTAMP;
