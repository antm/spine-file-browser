# Spine File Browser Plugin

## Project Overview

An Obsidian plugin providing a Ulysses-style two-column file browser with custom drag-and-drop ordering, multiple sort modes, inline rename, and search.

### Key Source Files
- [src/main.ts](src/main.ts) — Plugin entry point, settings load/save, vault event listeners
- [src/SpineView.ts](src/SpineView.ts) — All UI rendering: folder panel, file panel, drag-and-drop, search, context menus
- [src/types.ts](src/types.ts) — Shared types (`SpineSettings`, `SortMode`, `OrderingData`)

### Build Output
- `main.js` — bundled plugin file (generated, do not edit)
- `manifest.json`, `styles.css` — Obsidian plugin metadata and styles

## Development

### Build Commands
```bash
npm run dev       # watch mode (inline sourcemaps)
npm run build     # production build (minified, type-checked)
```

### Testing in Obsidian
Copy `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/spine-file-browser/` folder, then reload the plugin.

There is currently no automated test suite. Manual testing in a dev vault is the primary verification method.

## Architecture

- **SpineView** is a single `ItemView` subclass that owns all UI state
- **Ordering** is persisted as `{ [folderPath]: string[] }` via `plugin.saveData()`
- **Sort modes**: `manual` (drag order), `title`, `modified`, `created`
- Drag-and-drop works within the folder panel (tree reordering) and within the file panel
- Inline rename guards against concurrent vault refreshes via `isInlineEditing` flag

## Coding Conventions

- TypeScript strict mode — no `any`, prefer explicit types
- Obsidian API only — no external runtime dependencies
- DOM manipulation via Obsidian's `createDiv`, `createEl`, `setIcon` helpers
- Settings changes always followed by `plugin.saveSettings()`
- Keep `SpineView.ts` methods focused; extract helpers rather than growing large render methods

## UX Principles

- Resilient recovery over workarounds — let errors surface, notify the user with `new Notice(...)`, and offer a clear path forward
- Prefer Obsidian's native API patterns over custom implementations

## Team

| Role | Agent | Focus |
|------|-------|-------|
| Feature Developer | `feature-dev:feature-dev` | New capabilities (new sort modes, multi-vault, pinned files) |
| Code Reviewer | `feature-dev:code-reviewer` | PR review, bug triage, Obsidian API compliance |
| Frontend Designer | `frontend-design:frontend-design` | CSS, layout polish, accessibility, dark/light theme |
| UI Designer (File Mgmt) | `frontend-design:frontend-design` | File browser UX patterns: column layouts, drag affordances, tree navigation, file list density, keyboard nav, and conventions from Finder/VS Code/Ulysses |
| Simplifier | `simplify` | Refactor and reduce complexity after feature work |
