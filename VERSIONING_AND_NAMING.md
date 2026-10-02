# Filename Versioning

## Required behavior

If a new-content file has the same target filename as an existing cloud
object:

``` text
CHAPTER_5.pdf
CHAPTER_5(1).pdf
CHAPTER_5(2).pdf
CHAPTER_5(3).pdf
```

## Extension handling

Split the basename and extension.

``` text
CHAPTER_5.pdf
basename = CHAPTER_5
extension = .pdf
```

Then generate:

``` text
CHAPTER_5(1).pdf
```

For a filename without extension:

``` text
README
README(1)
```

For multiple dots:

``` text
archive.tar.gz
archive.tar(1).gz
```

## Collision algorithm

Do not trust a client-side count alone.

Use a transaction/atomic reservation in the metadata database or a
deterministic object reservation mechanism.

Conceptually:

``` text
candidate = original
if occupied(candidate):
    n = 1
    while occupied(original + "(" + n + ")" + extension):
        n++
    candidate = original + "(" + n + ")" + extension
```

## Concurrency

Two workers must never both successfully reserve the same version name.

Use a database transaction/unique constraint.

## Same hash after name conflict

Order matters:

1.  Calculate hash.
2.  Check global hash index.
3.  If hash exists: skip.
4.  If hash does not exist: reserve filename.
5.  Upload.
6.  Commit successful metadata/index.
