# CelAnchor

English | [日本語](README.md)

CelAnchor is a local web app for editing sprite animations from irregular sprite sheets. It lets you adjust each frame's crop rectangle and alignment, preview the animation, and export same-sized PNG frames.

Images are processed in the browser and are not uploaded to an external service. The app has no required npm dependency for normal use.

## Start

On Windows, run `start.bat` or:

```powershell
./start.ps1
```

If Python is available, CelAnchor starts a local server and opens `http://localhost:8765`. You can also open `index.html` directly, although browser restrictions can limit automatic loading of bundled samples.

## Main capabilities

- Load PNG, WebP, and JPEG sprite sheets.
- Load, paste, edit, and save CelAnchor Project JSON.
- Set per-frame crop rectangles, pivots, offsets, duration, and enabled state.
- Preview animation with onion-skin and frame comparison tools.
- Auto-trim transparent margins while preserving visual alignment.
- Calculate one output canvas that contains all enabled frames.
- Export same-sized PNG frames and edited project JSON in a ZIP archive.
- Undo/redo and browser-local temporary workspace persistence.

## Project format

- `celanchor-project.schema.json` — JSON Schema Draft 2020-12.
- `sample.celanchor.json` — safe sample project.
- `sample-sheet.png` — bundled sample sprite sheet.

The project JSON stores crop/alignment data but does not need workstation-specific paths.

## Public repository boundary

Do not commit credentials, `.env` files, local configuration, workstation-specific paths, editor/runtime state, or generated build output. Local-only files are excluded by `.gitignore`.

## License

MIT
