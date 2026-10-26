# 0033: Files kept with the inventory

## Status

Accepted.

## Context

Players keep more than card rows: a spreadsheet of their collection, receipts
from a purchase, scans, a PDF of a tournament ruling. They asked to put such
files in the inventory and open them again. Until now the app stored no files
at all; card images are hotlinked (ADR 0001) and the assistant's photos are
resized in the browser and not kept.

An uploaded file is untrusted content that the app would serve from its own
origin, so how it is stored and sent back matters more than the feature's size.

## Decision

### What is stored, and where

- The bytes live on disk under `<folder of the database file>/files/<user id>/<file id>`,
  named by the file's random id only. The user's file name never becomes part
  of a path, so a name like `../../app.db` can't reach anything; it is cut down
  to a plain name (no folders, no control characters, at most 200 characters)
  and kept in the database.
- Table `inventory_file` (`id`, `user_id`, `name`, `content_type`, `size`,
  `created_at`, migration 0019) is the listing. The folder sits beside
  `data/app.db`, so a deploy that leaves `data/` alone (ADR 0028) keeps the
  files, and a backup of `data/` holds both.
- Files are private: every query is scoped to the signed-in user, and another
  user's id answers 404. They are not shareable (ADR 0007 doesn't apply).

### Limits

25 MB per file, 20 files per upload, 200 files and 500 MB per user. The
declared body size is checked before the upload is read, and nothing is
written when one file of an upload is refused. The numbers are constants in
`shared/inventory-files.ts`.

### Opening a file

`GET /api/inventory/files/:id` shows a PDF, an image (PNG, JPEG, GIF, WebP) or
a `.txt` file in the browser and sends everything else as a download:
spreadsheets, Word files, SVG, HTML, scripts, archives, unknown types. The
decision comes from the file's extension, never from the type the browser
claimed, and the content type is the one the server derives. Every response
has `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`;
inline images and text also get `Content-Security-Policy: default-src 'none'; sandbox`
(a PDF doesn't, because a sandboxing policy stops the browser's PDF viewer).
`?download=1` forces a download. The page links to these URLs with plain
anchors, not router links, because they are server downloads.

An uploaded HTML or SVG file therefore can't run in the app's origin, and the
app's own CSP (ADR 0029) is untouched: it applies to rendered pages, and the
file routes are not pages.

### Where it appears

`/inventory/files`, reached from the inventory's header ("Dateien"): choose or
drop files, a list with open / download / delete, and a usage line.

## Consequences

- The app now keeps user data outside the database. A backup must include
  `data/files/`. Deleting a user removes the rows (`on delete cascade`) but not
  the bytes; there is no account deletion yet, and a cleanup job would be the
  place for it when there is.
- Stored files are not read by the server. Importing a card list from an
  `.xlsx` or `.csv` is the browser's job and goes through the quick-capture
  review ([ADR 0034](0034-card-list-from-spreadsheet.md)); the files page only
  hands the file over.
- There is no virus scan. Files are only ever downloaded or shown by the
  browser's own viewers under the rules above, never executed or rendered by
  the app.
- Three reasons for the filesystem over a `blob` column: SQLite stays small and
  fast to back up, streaming a file needs no row-sized memory, and the 25 MB
  limit keeps the folder easy to reason about.
