# Spine

A two-column, Ulysses-style file browser for [Obsidian](https://obsidian.md).

![Desktop Only](https://img.shields.io/badge/platform-desktop%20only-blue)

Spine replaces Obsidian's default file explorer with a two-panel layout: folders on the left, files on the right. Designed for writers transitioning from Ulysses or anyone who prefers a linear document browser over a tree view.

## Features

- **Two-column layout** — folders in the left panel, files in the right panel
- **Drag-and-drop ordering** — manually reorder files and folders (persisted across sessions)
- **Sort modes** — manual, by title, by modification date, or by creation date (ascending/descending)
- **All Files view** — see every file in your vault grouped by folder
- **Inline create & rename** — create notes and folders without leaving the browser
- **Search/filter** — quickly filter files in the current folder
- **File preview** — shows the first line of each note below the title
- **Resizable columns** — drag the divider to adjust panel widths
- **Collapse/expand** — toggle subfolder visibility in the folder tree
- **Keyboard navigation** — arrow keys to navigate, Enter to open
- **Right-click context menu** — rename, delete, open in new tab, reveal in system explorer

## Installation

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](https://github.com/antm/spine-file-browser/releases/latest)
2. Create a folder: `YourVault/.obsidian/plugins/spine-file-browser/`
3. Copy the three files into that folder
4. Restart Obsidian
5. Enable **Spine** in Settings → Community Plugins

### BRAT

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. Add `antm/spine-file-browser` as a beta plugin
3. Enable **Spine** in Settings → Community Plugins

## Usage

Click the columns icon in the left ribbon or use the command palette: **Spine: Open file browser**.

## License

MIT
