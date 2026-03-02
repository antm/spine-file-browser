import { ItemView, TFile, TFolder, WorkspaceLeaf, setIcon, Menu, Notice } from "obsidian";
import { VIEW_TYPE_SPINE, SortMode } from "./types";
import type SpinePlugin from "./main";

const SORT_LABELS: Record<SortMode, string> = {
	manual: "Manually",
	title: "By Title",
	modified: "By Modification Date",
	created: "By Creation Date",
};

const MAX_SUBFOLDER_DEPTH = 50;

export class SpineView extends ItemView {
	plugin: SpinePlugin;
	private folderListEl: HTMLElement;
	private fileListEl: HTMLElement;
	private selectedFolderPath: string;
	private dragState: { draggedEl: HTMLElement | null; draggedPath: string; sourcePanel: "folders" | "files" } | null = null;
	private collapsedFolders: Set<string> = new Set();
	private searchQuery: string = "";
	private fileListScrollEl: HTMLElement | null = null;
	private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private isInlineEditing: boolean = false;
	private pendingRefresh: boolean = false;

	constructor(leaf: WorkspaceLeaf, plugin: SpinePlugin) {
		super(leaf);
		this.plugin = plugin;
		this.selectedFolderPath = plugin.settings.lastSelectedFolder || "/";
	}

	getViewType(): string {
		return VIEW_TYPE_SPINE;
	}

	getDisplayText(): string {
		return "Spine";
	}

	getIcon(): string {
		return "columns-2";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		if (!(container instanceof HTMLElement)) return;
		container.empty();
		container.addClass("spine-browser");
		container.style.padding = "0";

		const wrapper = container.createDiv({ cls: "spine-columns" });
		this.folderListEl = wrapper.createDiv({ cls: "spine-folder-list" });
		const divider = wrapper.createDiv({ cls: "spine-divider" });
		this.fileListEl = wrapper.createDiv({ cls: "spine-file-list" });
		this.setupColumnResize(divider);

		if (this.plugin.settings.folderColumnWidth !== null) {
			this.folderListEl.style.width = `${this.plugin.settings.folderColumnWidth}px`;
		}

		// Validate selectedFolderPath still exists
		if (
			this.selectedFolderPath !== "/" &&
			!this.app.vault.getAbstractFileByPath(this.selectedFolderPath)
		) {
			this.selectedFolderPath = "/";
		}

		this.renderFolders();
		this.renderFiles();

		// Listen for active file changes to highlight + scroll
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.highlightActiveFile();
			})
		);
	}

	private endInlineEditing() {
		this.isInlineEditing = false;
		if (this.pendingRefresh) {
			this.pendingRefresh = false;
			this.refresh();
		}
	}

	private setupColumnResize(divider: HTMLElement) {
		let startX: number;
		let startWidth: number;

		const onMouseMove = (e: MouseEvent) => {
			const delta = e.clientX - startX;
			const newWidth = Math.max(100, Math.min(startWidth + delta, this.folderListEl.parentElement!.clientWidth * 0.7));
			this.folderListEl.style.width = `${newWidth}px`;
		};

		const onMouseUp = () => {
			divider.removeClass("is-dragging");
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			this.plugin.settings.folderColumnWidth = this.folderListEl.offsetWidth;
			void this.plugin.saveSettings();
		};

		divider.addEventListener("mousedown", (e) => {
			e.preventDefault();
			startX = e.clientX;
			startWidth = this.folderListEl.offsetWidth;
			divider.addClass("is-dragging");
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("mouseup", onMouseUp);
		});
	}

	async onClose() {
		if (this.searchDebounceTimer) {
			clearTimeout(this.searchDebounceTimer);
		}
		this.plugin.settings.lastSelectedFolder = this.selectedFolderPath;
		await this.plugin.saveSettings();
	}

	refresh() {
		// Don't re-render while user is typing in an inline input (rename/create)
		// Queue it so we refresh as soon as editing ends
		if (this.isInlineEditing) {
			this.pendingRefresh = true;
			return;
		}

		// Validate selectedFolderPath still exists (may have been deleted externally)
		if (
			this.selectedFolderPath !== "/" &&
			!this.app.vault.getAbstractFileByPath(this.selectedFolderPath)
		) {
			this.selectedFolderPath = "/";
			this.plugin.settings.lastSelectedFolder = "/";
		}
		this.renderFolders();
		this.renderFiles();
	}

	// ── ACTIVE FILE TRACKING ──

	private highlightActiveFile() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		// Remove old active states
		this.fileListEl.querySelectorAll(".spine-file-item.is-active").forEach((el) => {
			el.removeClass("is-active");
		});

		// Find and highlight the active file
		const activeEl = this.fileListEl.querySelector(
			`.spine-file-item[data-path="${CSS.escape(activeFile.path)}"]`
		) as HTMLElement | null;

		if (activeEl) {
			activeEl.addClass("is-active");
			activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
		}
	}

	// ── FOLDER COLUMN ──

	private renderFolders() {
		this.folderListEl.empty();

		const header = this.folderListEl.createDiv({ cls: "spine-panel-header" });
		header.createSpan({ text: "Folders", cls: "spine-panel-title" });

		const actions = header.createDiv({ cls: "spine-header-actions" });

		const newFolderBtn = actions.createDiv({ cls: "spine-header-btn", attr: { "aria-label": "New folder" } });
		setIcon(newFolderBtn, "folder-plus");
		newFolderBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.createNewFolder();
		});

		const newNoteBtn = actions.createDiv({ cls: "spine-header-btn", attr: { "aria-label": "New note" } });
		setIcon(newNoteBtn, "file-plus");
		newNoteBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.createNewNote();
		});

		const listEl = this.folderListEl.createDiv({ cls: "spine-list" });
		listEl.setAttribute("tabindex", "0");
		this.setupKeyboardNav(listEl, "folders");

		const rootFolder = this.app.vault.getRoot();
		const folders = this.getOrderedFolders(rootFolder);

		this.createFolderItem(listEl, "/", "All Files", 0);

		for (const folder of folders) {
			this.renderFolderTree(listEl, folder, 0);
		}
	}

	private renderFolderTree(parentEl: HTMLElement, folder: TFolder, depth: number) {
		if (depth > MAX_SUBFOLDER_DEPTH) return;

		this.createFolderItem(parentEl, folder.path, folder.name, depth);

		if (!this.collapsedFolders.has(folder.path)) {
			const subfolders = this.getOrderedFolders(folder);
			for (const sub of subfolders) {
				this.renderFolderTree(parentEl, sub, depth + 1);
			}
		}
	}

	private createFolderItem(parentEl: HTMLElement, path: string, name: string, depth: number) {
		const item = parentEl.createDiv({
			cls: `spine-folder-item ${path === this.selectedFolderPath ? "is-selected" : ""}`,
		});
		item.style.paddingLeft = `${8 + depth * 16}px`;
		item.setAttribute("data-path", path);
		item.setAttribute("draggable", "true");

		// Collapse/expand chevron
		const hasSubfolders = this.folderHasSubfolders(path);
		if (hasSubfolders && path !== "/") {
			const chevron = item.createSpan({ cls: "spine-folder-chevron" });
			const isCollapsed = this.collapsedFolders.has(path);
			setIcon(chevron, isCollapsed ? "chevron-right" : "chevron-down");
			chevron.addEventListener("click", (evt) => {
				evt.stopPropagation();
				if (this.collapsedFolders.has(path)) {
					this.collapsedFolders.delete(path);
				} else {
					this.collapsedFolders.add(path);
				}
				this.renderFolders();
			});
		} else {
			item.createSpan({ cls: "spine-folder-chevron-spacer" });
		}

		const iconEl = item.createSpan({ cls: "spine-folder-icon" });
		setIcon(iconEl, path === "/" ? "vault" : "folder");

		item.createSpan({ text: name, cls: "spine-folder-name" });

		const count = this.countFilesRecursive(path);
		if (count > 0) {
			item.createSpan({ text: `${count}`, cls: "spine-folder-count" });
		}

		item.addEventListener("click", () => {
			this.selectedFolderPath = path;
			this.searchQuery = "";
			this.renderFolders();
			this.renderFiles();
			this.plugin.settings.lastSelectedFolder = path;
			void this.plugin.saveSettings();
		});

		// Allow dropping files onto folders to move them
		item.addEventListener("dragover", (evt) => {
			if (this.dragState && this.dragState.sourcePanel === "files" && path !== "/") {
				evt.preventDefault();
				if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
				item.addClass("spine-drop-target");
				return;
			}
			if (this.dragState && this.dragState.sourcePanel === "folders") {
				evt.preventDefault();
				if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";

				const rect = item.getBoundingClientRect();
				const midY = rect.top + rect.height / 2;
				item.removeClass("spine-drop-above");
				item.removeClass("spine-drop-below");

				if (evt.clientY < midY) {
					item.addClass("spine-drop-above");
				} else {
					item.addClass("spine-drop-below");
				}
			}
		});

		item.addEventListener("dragleave", () => {
			item.removeClass("spine-drop-above");
			item.removeClass("spine-drop-below");
			item.removeClass("spine-drop-target");
		});

		item.addEventListener("drop", async (evt) => {
			evt.preventDefault();
			item.removeClass("spine-drop-above");
			item.removeClass("spine-drop-below");
			item.removeClass("spine-drop-target");

			if (!this.dragState) return;

			// Moving a file into a folder
			if (this.dragState.sourcePanel === "files" && path !== "/") {
				const filePath = this.dragState.draggedPath;
				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (file instanceof TFile) {
					const newPath = `${path}/${file.name}`;
					if (this.app.vault.getAbstractFileByPath(newPath)) {
						new Notice(`A file named "${file.name}" already exists in that folder.`);
						return;
					}
					try {
						await this.app.fileManager.renameFile(file, newPath);
						new Notice(`Moved "${file.name}" to ${path}`);
					} catch (e) {
						new Notice(`Could not move file: ${e}`);
					}
				}
				return;
			}

			// Normal folder reorder
			if (this.dragState.sourcePanel === "folders") {
				const draggedPath = this.dragState.draggedPath;
				const targetPath = path;
				if (draggedPath === targetPath) return;

				const rect = item.getBoundingClientRect();
				const midY = rect.top + rect.height / 2;
				const insertBefore = evt.clientY < midY;

				await this.reorderItem(draggedPath, targetPath, insertBefore, "folders");
				this.renderFolders();
			}
		});

		item.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			const menu = new Menu();
			if (path !== "/") {
				menu.addItem((menuItem) => {
					menuItem.setTitle("Rename");
					menuItem.setIcon("pencil");
					menuItem.onClick(() => this.showRenameInput(item, path, true));
				});
				menu.addItem((menuItem) => {
					menuItem.setTitle("Delete");
					menuItem.setIcon("trash-2");
					menuItem.onClick(() => this.deleteItem(path, true));
				});
			}
			menu.addItem((menuItem) => {
				menuItem.setTitle("New note here");
				menuItem.setIcon("file-plus");
				menuItem.onClick(() => this.createNewNote(path));
			});
			menu.addItem((menuItem) => {
				menuItem.setTitle("New folder here");
				menuItem.setIcon("folder-plus");
				menuItem.onClick(() => this.createNewFolder(path));
			});
			if (path !== "/") {
				menu.addSeparator();
				menu.addItem((menuItem) => {
					menuItem.setTitle("Reveal in system explorer");
					menuItem.setIcon("folder-open");
					menuItem.onClick(() => {
						if (typeof (this.app as any).showInFolder === "function") {
							(this.app as any).showInFolder(path);
						}
					});
				});
			}
			menu.showAtMouseEvent(evt);
		});

		// Folder drag start (for reorder)
		item.addEventListener("dragstart", (evt) => {
			if (path === "/") { evt.preventDefault(); return; }
			this.dragState = { draggedEl: item, draggedPath: path, sourcePanel: "folders" };
			item.addClass("is-dragging");
			if (evt.dataTransfer) {
				evt.dataTransfer.effectAllowed = "move";
				evt.dataTransfer.setData("text/plain", path);
			}
		});

		item.addEventListener("dragend", () => {
			item.removeClass("is-dragging");
			this.dragState = null;
			this.containerEl.querySelectorAll(".spine-drop-above, .spine-drop-below, .spine-drop-target").forEach((el) => {
				el.removeClass("spine-drop-above");
				el.removeClass("spine-drop-below");
				el.removeClass("spine-drop-target");
			});
		});
	}

	// ── FILE COLUMN (with grouped subfolders) ──

	private showSortMenu(evt: MouseEvent) {
		const menu = new Menu();
		const modes: SortMode[] = ["manual", "title", "modified", "created"];
		for (const mode of modes) {
			menu.addItem((menuItem) => {
				menuItem.setTitle(
					(this.plugin.settings.sortMode === mode ? "\u2713 " : "  ") + SORT_LABELS[mode]
				);
				menuItem.onClick(async () => {
					if (this.plugin.settings.sortMode === mode && mode !== "manual") {
						this.plugin.settings.sortAscending = !this.plugin.settings.sortAscending;
					} else {
						this.plugin.settings.sortMode = mode;
						this.plugin.settings.sortAscending = mode === "title";
					}
					await this.plugin.saveSettings();
					this.renderFiles();
				});
			});
		}
		if (this.plugin.settings.sortMode !== "manual") {
			menu.addSeparator();
			menu.addItem((menuItem) => {
				const isAsc = this.plugin.settings.sortAscending;
				menuItem.setTitle(isAsc ? "\u2713 Ascending" : "  Ascending");
				menuItem.setIcon("arrow-up");
				menuItem.onClick(async () => {
					this.plugin.settings.sortAscending = true;
					await this.plugin.saveSettings();
					this.renderFiles();
				});
			});
			menu.addItem((menuItem) => {
				const isAsc = this.plugin.settings.sortAscending;
				menuItem.setTitle(!isAsc ? "\u2713 Descending" : "  Descending");
				menuItem.setIcon("arrow-down");
				menuItem.onClick(async () => {
					this.plugin.settings.sortAscending = false;
					await this.plugin.saveSettings();
					this.renderFiles();
				});
			});
		}
		menu.showAtMouseEvent(evt);
	}

	private getSortIcon(): string {
		const mode = this.plugin.settings.sortMode;
		const asc = this.plugin.settings.sortAscending;
		if (mode === "manual") return "grip-vertical";
		if (mode === "title") return asc ? "sort-asc" : "sort-desc";
		if (mode === "modified") return asc ? "clock" : "clock";
		if (mode === "created") return asc ? "calendar" : "calendar";
		return "arrow-up-down";
	}

	private renderFiles() {
		this.fileListEl.empty();

		const header = this.fileListEl.createDiv({ cls: "spine-panel-header" });
		const folderName = this.selectedFolderPath === "/"
			? "All Files"
			: this.selectedFolderPath.split("/").pop();
		header.createSpan({ text: folderName ?? "Files", cls: "spine-panel-title" });

		const headerActions = header.createDiv({ cls: "spine-header-actions" });

		const searchBtn = headerActions.createDiv({ cls: "spine-header-btn", attr: { "aria-label": "Search files" } });
		setIcon(searchBtn, "search");
		searchBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.toggleSearch();
		});

		const sortLabel = SORT_LABELS[this.plugin.settings.sortMode];
		const dirLabel = this.plugin.settings.sortAscending ? "Asc" : "Desc";
		const sortBtn = headerActions.createDiv({
			cls: "spine-header-btn spine-sort-btn",
			attr: { "aria-label": `Sort: ${sortLabel} (${dirLabel})` },
		});
		setIcon(sortBtn, this.getSortIcon());
		sortBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.showSortMenu(evt);
		});

		// Search bar (shown if query is active)
		if (this.searchQuery !== "") {
			this.renderSearchBar();
		}

		const listEl = this.fileListEl.createDiv({ cls: "spine-list" });
		this.fileListScrollEl = listEl;
		listEl.setAttribute("tabindex", "0");
		this.setupKeyboardNav(listEl, "files");
		this.setupListTopDropZone(listEl);

		const folder = this.selectedFolderPath === "/"
			? this.app.vault.getRoot()
			: this.app.vault.getAbstractFileByPath(this.selectedFolderPath);

		if (!(folder instanceof TFolder)) {
			const empty = listEl.createDiv({ cls: "spine-empty" });
			empty.createSpan({ text: "No files" });
			return;
		}

		const directFiles = this.getFilteredFiles(this.getOrderedFiles(this.selectedFolderPath));
		for (const file of directFiles) {
			this.createFileItem(listEl, file);
		}

		this.renderSubfolderFiles(listEl, folder, 0);

		if (listEl.childElementCount === 0) {
			const empty = listEl.createDiv({ cls: "spine-empty" });
			empty.createSpan({ text: this.searchQuery ? "No matching files" : "No files" });
		}
	}

	private renderSubfolderFiles(listEl: HTMLElement, parentFolder: TFolder, depth: number) {
		if (depth > MAX_SUBFOLDER_DEPTH) return;

		const subfolders = this.getOrderedFolders(parentFolder);

		for (const subfolder of subfolders) {
			const totalCount = this.countFolderFiles(subfolder);
			if (totalCount === 0) continue;

			const subFiles = this.getFilteredFiles(this.getOrderedFiles(subfolder.path));
			const hasFilteredContent = subFiles.length > 0 || this.hasFilteredSubfolderFiles(subfolder);

			if (this.searchQuery && !hasFilteredContent) continue;

			const groupHeader = listEl.createDiv({ cls: "spine-group-header" });
			const groupIconEl = groupHeader.createSpan({ cls: "spine-group-icon" });
			setIcon(groupIconEl, "folder");
			groupHeader.createSpan({ text: subfolder.name, cls: "spine-group-name" });
			groupHeader.createSpan({ text: `${this.searchQuery ? subFiles.length : totalCount}`, cls: "spine-group-count" });

			groupHeader.addEventListener("click", () => {
				this.selectedFolderPath = subfolder.path;
				this.searchQuery = "";
				this.renderFolders();
				this.renderFiles();
				this.plugin.settings.lastSelectedFolder = subfolder.path;
				void this.plugin.saveSettings();
			});

			for (const file of subFiles) {
				this.createFileItem(listEl, file);
			}

			this.renderSubfolderFiles(listEl, subfolder, depth + 1);
		}
	}

	private createFileItem(parentEl: HTMLElement, file: TFile) {
		const item = parentEl.createDiv({ cls: "spine-file-item" });
		item.setAttribute("data-path", file.path);
		// Only allow drag reorder in manual mode AND when viewing a specific folder (not All Files)
		const isManual = this.plugin.settings.sortMode === "manual";
		const canDrag = isManual && this.selectedFolderPath !== "/";
		item.setAttribute("draggable", canDrag ? "true" : "false");

		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.path === file.path) {
			item.addClass("is-active");
		}

		const nameEl = item.createDiv({ cls: "spine-file-name" });
		const displayName = this.plugin.settings.showFileExtensions
			? file.name
			: file.basename;
		nameEl.setText(displayName);

		const previewEl = item.createDiv({ cls: "spine-file-preview" });
		this.loadPreview(file, previewEl);

		const metaEl = item.createDiv({ cls: "spine-file-meta" });
		const date = new Date(file.stat.mtime);
		metaEl.setText(this.formatDate(date));

		item.addEventListener("click", async () => {
			try {
				await this.app.workspace.getLeaf().openFile(file);
			} catch (e) {
				new Notice(`Could not open file: ${e}`);
			}
			this.renderFiles();
		});

		item.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			const menu = new Menu();
			menu.addItem((menuItem) => {
				menuItem.setTitle("Rename");
				menuItem.setIcon("pencil");
				menuItem.onClick(() => this.showRenameInput(item, file.path, false));
			});
			menu.addItem((menuItem) => {
				menuItem.setTitle("Delete");
				menuItem.setIcon("trash-2");
				menuItem.onClick(() => this.deleteItem(file.path, false));
			});
			menu.addSeparator();
			menu.addItem((menuItem) => {
				menuItem.setTitle("Open in new tab");
				menuItem.setIcon("file-plus");
				menuItem.onClick(async () => {
					await this.app.workspace.getLeaf("tab").openFile(file);
				});
			});
			menu.addItem((menuItem) => {
				menuItem.setTitle("Reveal in system explorer");
				menuItem.setIcon("folder-open");
				menuItem.onClick(() => {
					if (typeof (this.app as any).showInFolder === "function") {
						(this.app as any).showInFolder(file.path);
					}
				});
			});
			menu.showAtMouseEvent(evt);
		});

		this.setupDragHandlers(item, file.path, "files");
	}

	// ── SEARCH / FILTER ──

	private toggleSearch() {
		const existing = this.fileListEl.querySelector(".spine-search-bar");
		if (existing) {
			this.searchQuery = "";
			existing.remove();
			this.renderFiles();
		} else {
			this.renderSearchBar();
			const input = this.fileListEl.querySelector(".spine-search-input") as HTMLInputElement | null;
			if (input) input.focus();
		}
	}

	private renderSearchBar() {
		if (this.fileListEl.querySelector(".spine-search-bar")) return;

		const bar = createDiv({ cls: "spine-search-bar" });
		const iconEl = bar.createSpan({ cls: "spine-search-icon" });
		setIcon(iconEl, "search");
		const input = bar.createEl("input", {
			type: "text",
			placeholder: "Filter files...",
			cls: "spine-search-input",
			value: this.searchQuery,
		});

		const clearBtn = bar.createDiv({ cls: "spine-search-clear" });
		setIcon(clearBtn, "x");
		clearBtn.addEventListener("click", () => {
			this.searchQuery = "";
			bar.remove();
			this.renderFiles();
		});

		input.addEventListener("input", () => {
			this.searchQuery = input.value;

			// Debounce re-render for performance on large vaults
			if (this.searchDebounceTimer) {
				clearTimeout(this.searchDebounceTimer);
			}
			this.searchDebounceTimer = setTimeout(() => {
				this.rebuildFileList();
			}, 150);
		});

		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Escape") {
				this.searchQuery = "";
				bar.remove();
				this.renderFiles();
			}
		});

		// Insert after header, before list
		const header = this.fileListEl.querySelector(".spine-panel-header");
		if (header && header.nextSibling) {
			this.fileListEl.insertBefore(bar, header.nextSibling);
		} else {
			this.fileListEl.appendChild(bar);
		}
	}

	/** Rebuild just the file list portion (used by search to avoid destroying the search bar) */
	private rebuildFileList() {
		const listEl = this.fileListEl.querySelector(".spine-list");
		if (listEl) listEl.remove();

		const newListEl = this.fileListEl.createDiv({ cls: "spine-list" });
		this.fileListScrollEl = newListEl;
		newListEl.setAttribute("tabindex", "0");
		this.setupKeyboardNav(newListEl, "files");
		this.setupListTopDropZone(newListEl);

		const folder = this.selectedFolderPath === "/"
			? this.app.vault.getRoot()
			: this.app.vault.getAbstractFileByPath(this.selectedFolderPath);

		if (folder instanceof TFolder) {
			const directFiles = this.getFilteredFiles(this.getOrderedFiles(this.selectedFolderPath));
			for (const file of directFiles) {
				this.createFileItem(newListEl, file);
			}
			this.renderSubfolderFiles(newListEl, folder, 0);
		}

		if (newListEl.childElementCount === 0) {
			const empty = newListEl.createDiv({ cls: "spine-empty" });
			empty.createSpan({ text: this.searchQuery ? "No matching files" : "No files" });
		}
	}

	private getFilteredFiles(files: TFile[]): TFile[] {
		if (!this.searchQuery) return files;
		const query = this.searchQuery.toLowerCase();
		return files.filter((f) => f.basename.toLowerCase().includes(query));
	}

	private hasFilteredSubfolderFiles(folder: TFolder): boolean {
		const subfolders = folder.children.filter((c): c is TFolder => c instanceof TFolder);
		for (const sub of subfolders) {
			const subFiles = this.getFilteredFiles(this.getOrderedFiles(sub.path));
			if (subFiles.length > 0) return true;
			if (this.hasFilteredSubfolderFiles(sub)) return true;
		}
		return false;
	}

	// ── DELETE ──

	private async deleteItem(path: string, isFolder: boolean) {
		const abstractFile = this.app.vault.getAbstractFileByPath(path);
		if (!abstractFile) {
			new Notice("File not found.");
			return;
		}

		const name = path.split("/").pop() || path;
		const type = isFolder ? "folder" : "note";

		try {
			await this.app.vault.trash(abstractFile, true);
			new Notice(`Moved "${name}" to trash.`);

			// Clean up ordering references for the deleted item
			this.removeFromOrdering(path);

			// If we deleted the selected folder (or a parent of it), go to root
			if (isFolder && (this.selectedFolderPath === path || this.selectedFolderPath.startsWith(path + "/"))) {
				this.selectedFolderPath = "/";
				this.plugin.settings.lastSelectedFolder = "/";
			}
			await this.plugin.saveSettings();
		} catch (e) {
			new Notice(`Could not delete ${type}: ${e}`);
		}
	}

	/** Remove a path from all ordering arrays */
	private removeFromOrdering(path: string) {
		const ordering = this.plugin.settings.ordering;
		for (const key of Object.keys(ordering)) {
			const paths = ordering[key];
			if (!paths) continue;
			const idx = paths.indexOf(path);
			if (idx !== -1) {
				paths.splice(idx, 1);
				if (paths.length === 0) {
					delete ordering[key];
				}
			}
		}
		// Also remove any ordering keys that reference this path as a parent
		// (e.g., `files:deletedFolder` or `folders:deletedFolder`)
		for (const key of Object.keys(ordering)) {
			if (key.endsWith(`:${path}`) || key.includes(`:${path}/`)) {
				delete ordering[key];
			}
		}
	}

	/** Update ordering entries when a file/folder is renamed */
	private updateOrderingOnRename(oldPath: string, newPath: string, isFolder: boolean) {
		const ordering = this.plugin.settings.ordering;

		// Replace old path with new path in all ordering arrays
		for (const key of Object.keys(ordering)) {
			const paths = ordering[key];
			if (!paths) continue;
			const idx = paths.indexOf(oldPath);
			if (idx !== -1) {
				paths[idx] = newPath;
			}
		}

		// For folders, also update ordering keys that reference the old folder path
		if (isFolder) {
			for (const key of Object.keys(ordering)) {
				if (key.endsWith(`:${oldPath}`) || key.includes(`:${oldPath}/`)) {
					const newKey = key.replace(oldPath, newPath);
					ordering[newKey] = ordering[key]!;
					delete ordering[key];
				}
			}
		}
	}

	// ── KEYBOARD NAVIGATION ──

	private setupKeyboardNav(listEl: HTMLElement, panel: "folders" | "files") {
		listEl.addEventListener("keydown", (evt) => {
			const itemSelector = panel === "folders" ? ".spine-folder-item" : ".spine-file-item";
			const items = Array.from(listEl.querySelectorAll(itemSelector)) as HTMLElement[];
			if (items.length === 0) return;

			const focusedClass = panel === "folders" ? "is-selected" : "is-keyboard-focused";
			const currentIndex = items.findIndex((el) => el.hasClass(focusedClass));

			if (evt.key === "ArrowDown" || evt.key === "j") {
				evt.preventDefault();
				const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
				this.focusItem(items, nextIndex, panel);
			} else if (evt.key === "ArrowUp" || evt.key === "k") {
				evt.preventDefault();
				const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
				this.focusItem(items, prevIndex, panel);
			} else if (evt.key === "Enter") {
				evt.preventDefault();
				const target = currentIndex >= 0 ? items[currentIndex] : undefined;
				if (target) target.click();
			}
		});
	}

	private focusItem(items: HTMLElement[], index: number, panel: "folders" | "files") {
		const target = items[index];
		if (!target) return;
		if (panel === "files") {
			items.forEach((el) => el.removeClass("is-keyboard-focused"));
			target.addClass("is-keyboard-focused");
			target.scrollIntoView({ behavior: "smooth", block: "nearest" });
		} else {
			target.click();
		}
	}

	// ── CREATE ACTIONS ──

	private createNewNote(folderPath?: string) {
		const targetPath = folderPath ?? this.selectedFolderPath;

		// Validate target folder still exists
		if (targetPath !== "/" && !this.app.vault.getAbstractFileByPath(targetPath)) {
			new Notice("Target folder no longer exists.");
			return;
		}

		if (targetPath !== this.selectedFolderPath) {
			this.selectedFolderPath = targetPath;
			this.renderFolders();
		}

		this.renderFiles();
		const listEl = this.fileListEl.querySelector(".spine-list");
		if (!listEl) return;

		this.isInlineEditing = true;

		const inputRow = createDiv({ cls: "spine-inline-input" });
		const iconEl = inputRow.createSpan({ cls: "spine-inline-icon" });
		setIcon(iconEl, "file-text");
		const input = inputRow.createEl("input", {
			type: "text",
			placeholder: "Note name...",
			cls: "spine-inline-field",
		});
		listEl.prepend(inputRow);
		input.focus();

		const cleanup = () => { this.endInlineEditing(); };

		const commit = async () => {
			const name = input.value.trim();
			if (!name) {
				inputRow.remove();
				cleanup();
				return;
			}
			const basePath = targetPath === "/" ? "" : targetPath;
			const prefix = basePath ? `${basePath}/` : "";
			const fullPath = `${prefix}${name.endsWith(".md") ? name : name + ".md"}`;
			if (this.app.vault.getAbstractFileByPath(fullPath)) {
				new Notice(`"${name}" already exists.`);
				input.focus();
				return;
			}
			try {
				const file = await this.app.vault.create(fullPath, "");
				const leaf = this.app.workspace.getLeaf();
				if (leaf) await leaf.openFile(file);
			} catch (e) {
				new Notice(`Could not create note: ${e}`);
			}
			cleanup();
		};

		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") { evt.preventDefault(); void commit(); }
			if (evt.key === "Escape") { inputRow.remove(); cleanup(); }
		});
		input.addEventListener("blur", () => {
			setTimeout(() => { if (inputRow.parentElement) { inputRow.remove(); cleanup(); } }, 150);
		});
	}

	private createNewFolder(parentPath?: string) {
		const targetPath = parentPath ?? this.selectedFolderPath;

		// Validate target folder still exists
		if (targetPath !== "/" && !this.app.vault.getAbstractFileByPath(targetPath)) {
			new Notice("Target folder no longer exists.");
			return;
		}

		this.renderFolders();
		const listEl = this.folderListEl.querySelector(".spine-list");
		if (!listEl) return;

		this.isInlineEditing = true;

		const parentDepth = targetPath === "/" ? 0 : targetPath.split("/").length;
		const inputRow = createDiv({ cls: "spine-inline-input" });
		inputRow.style.paddingLeft = `${8 + parentDepth * 16}px`;
		const iconEl = inputRow.createSpan({ cls: "spine-inline-icon" });
		setIcon(iconEl, "folder");
		const input = inputRow.createEl("input", {
			type: "text",
			placeholder: "Folder name...",
			cls: "spine-inline-field",
		});
		const selectedEl = listEl.querySelector(`[data-path="${CSS.escape(targetPath)}"]`);
		if (selectedEl && selectedEl.nextSibling) {
			listEl.insertBefore(inputRow, selectedEl.nextSibling);
		} else {
			listEl.appendChild(inputRow);
		}
		input.focus();

		const cleanup = () => { this.endInlineEditing(); };

		const commit = async () => {
			const name = input.value.trim();
			if (!name) {
				inputRow.remove();
				cleanup();
				return;
			}
			const basePath = targetPath === "/" ? "" : targetPath;
			const prefix = basePath ? `${basePath}/` : "";
			const fullPath = `${prefix}${name}`;
			if (this.app.vault.getAbstractFileByPath(fullPath)) {
				new Notice(`"${name}" already exists.`);
				input.focus();
				return;
			}
			try {
				await this.app.vault.createFolder(fullPath);
				this.selectedFolderPath = fullPath;
				this.plugin.settings.lastSelectedFolder = fullPath;
				await this.plugin.saveSettings();
			} catch (e) {
				new Notice(`Could not create folder: ${e}`);
			}
			cleanup();
		};

		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") { evt.preventDefault(); void commit(); }
			if (evt.key === "Escape") { inputRow.remove(); cleanup(); }
		});
		input.addEventListener("blur", () => {
			setTimeout(() => { if (inputRow.parentElement) { inputRow.remove(); cleanup(); } }, 150);
		});
	}

	// ── RENAME ──

	private showRenameInput(item: HTMLElement, currentPath: string, isFolder: boolean) {
		const currentName = currentPath.split("/").pop() || "";
		// Extract extension properly: use lastIndexOf to handle multi-dot filenames (e.g., "report.2025.md")
		const dotIndex = isFolder ? -1 : currentName.lastIndexOf(".");
		const nameWithoutExt = dotIndex > 0 ? currentName.substring(0, dotIndex) : currentName;
		const ext = dotIndex > 0 ? currentName.substring(dotIndex) : (isFolder ? "" : ".md");

		this.isInlineEditing = true;

		// Replace item content with input; on cancel/error, re-render the whole panel
		// (cloneNode doesn't copy event listeners, so restoring DOM nodes is unsafe)
		item.empty();
		item.setAttribute("draggable", "false");

		const input = item.createEl("input", {
			type: "text",
			value: nameWithoutExt,
			cls: "spine-rename-field",
		});
		input.focus();
		input.select();

		const cancel = () => {
			this.endInlineEditing();
			// Re-render the panel to restore full interactivity
			if (isFolder) {
				this.renderFolders();
			} else {
				this.renderFiles();
			}
		};

		let committed = false;
		const commit = async () => {
			if (committed) return;
			committed = true;

			const newName = input.value.trim();
			if (!newName || newName === nameWithoutExt) {
				cancel();
				return;
			}

			const parentPath = this.getParentPath(currentPath);
			const prefix = parentPath === "/" ? "" : parentPath + "/";
			const newPath = `${prefix}${newName}${ext}`;

			if (this.app.vault.getAbstractFileByPath(newPath)) {
				new Notice(`"${newName}" already exists.`);
				committed = false;
				input.focus();
				return;
			}

			try {
				const abstractFile = this.app.vault.getAbstractFileByPath(currentPath);
				if (!abstractFile) {
					new Notice("File was deleted.");
					cancel();
					return;
				}
				// Update ordering keys before rename
				this.updateOrderingOnRename(currentPath, newPath, isFolder);
				await this.app.fileManager.renameFile(abstractFile, newPath);
				if (isFolder && this.selectedFolderPath === currentPath) {
					this.selectedFolderPath = newPath;
					this.plugin.settings.lastSelectedFolder = newPath;
				}
				await this.plugin.saveSettings();
				this.endInlineEditing();
			} catch (e) {
				new Notice(`Could not rename: ${e}`);
				cancel();
			}
		};

		input.addEventListener("keydown", (evt) => {
			evt.stopPropagation();
			if (evt.key === "Enter") { evt.preventDefault(); void commit(); }
			if (evt.key === "Escape") { cancel(); }
		});
		input.addEventListener("blur", () => {
			setTimeout(() => {
				if (!committed) void commit();
			}, 100);
		});
	}

	// ── DRAG & DROP ──

	/**
	 * Adds dragover/drop listeners to the list container so that dropping above
	 * the first file item (into the empty top padding area) inserts at position 0.
	 * Without this, the browser rejects drops in that zone entirely.
	 */
	private setupListTopDropZone(listEl: HTMLElement) {
		listEl.addEventListener("dragover", (evt) => {
			if (!this.dragState || this.dragState.sourcePanel !== "files") return;
			const firstItem = listEl.querySelector(".spine-file-item") as HTMLElement | null;
			if (!firstItem || evt.clientY >= firstItem.getBoundingClientRect().top) return;
			evt.preventDefault();
			if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
			this.containerEl.querySelectorAll(".spine-drop-indicator, .spine-drop-above").forEach((s) => {
				s.removeClass("spine-drop-indicator");
				s.removeClass("spine-drop-above");
			});
			firstItem.addClass("spine-drop-above");
		});

		listEl.addEventListener("drop", async (evt) => {
			if (!this.dragState || this.dragState.sourcePanel !== "files") return;
			const firstItem = listEl.querySelector(".spine-file-item") as HTMLElement | null;
			if (!firstItem || evt.clientY >= firstItem.getBoundingClientRect().top) return;
			evt.preventDefault();
			this.containerEl.querySelectorAll(".spine-drop-indicator, .spine-drop-above").forEach((s) => {
				s.removeClass("spine-drop-indicator");
				s.removeClass("spine-drop-above");
			});
			const targetPath = firstItem.getAttribute("data-path");
			if (!targetPath || this.dragState.draggedPath === targetPath) return;
			await this.reorderItem(this.dragState.draggedPath, targetPath, true, "files");
			this.renderFiles();
		});
	}

	private setupDragHandlers(el: HTMLElement, path: string, panel: "folders" | "files") {
		el.addEventListener("dragstart", (evt) => {
			this.dragState = { draggedEl: el, draggedPath: path, sourcePanel: panel };
			el.addClass("is-dragging");
			if (evt.dataTransfer) {
				evt.dataTransfer.effectAllowed = "move";
				evt.dataTransfer.setData("text/plain", path);
			}
		});

		el.addEventListener("dragend", () => {
			el.removeClass("is-dragging");
			this.dragState = null;
			this.containerEl.querySelectorAll(".spine-drop-indicator, .spine-drop-above, .spine-drop-target").forEach((el) => {
				el.removeClass("spine-drop-indicator");
				el.removeClass("spine-drop-above");
				el.removeClass("spine-drop-target");
			});
		});

		el.addEventListener("dragover", (evt) => {
			evt.preventDefault();
			if (!this.dragState || this.dragState.sourcePanel !== panel) return;
			if (evt.dataTransfer) {
				evt.dataTransfer.dropEffect = "move";
			}

			// Clear ALL indicators, then show exactly one line
			this.containerEl.querySelectorAll(".spine-drop-indicator, .spine-drop-above").forEach((s) => {
				s.removeClass("spine-drop-indicator");
				s.removeClass("spine-drop-above");
			});

			const rect = el.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;

			if (evt.clientY < midY) {
				// Insert before this item → show indicator on previous sibling's bottom
				const prev = el.previousElementSibling as HTMLElement | null;
				if (prev && !prev.hasClass("spine-group-header")) {
					prev.addClass("spine-drop-indicator");
				} else {
					// First item in list/group — show top-edge line
					el.addClass("spine-drop-above");
				}
			} else {
				el.addClass("spine-drop-indicator");
			}
		});

		el.addEventListener("dragleave", () => {
			el.removeClass("spine-drop-indicator");
			el.removeClass("spine-drop-above");
		});

		el.addEventListener("drop", async (evt) => {
			evt.preventDefault();
			this.containerEl.querySelectorAll(".spine-drop-indicator, .spine-drop-above").forEach((s) => {
				s.removeClass("spine-drop-indicator");
				s.removeClass("spine-drop-above");
			});

			if (!this.dragState || this.dragState.sourcePanel !== panel) return;

			const draggedPath = this.dragState.draggedPath;
			const targetPath = el.getAttribute("data-path");
			if (!targetPath || draggedPath === targetPath) return;

			const rect = el.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			const insertBefore = evt.clientY < midY;

			if (panel === "folders") {
				await this.reorderItem(draggedPath, targetPath, insertBefore, "folders");
				this.renderFolders();
			} else {
				await this.reorderItem(draggedPath, targetPath, insertBefore, "files");
				this.renderFiles();
			}
		});
	}

	private async reorderItem(
		draggedPath: string,
		targetPath: string,
		insertBefore: boolean,
		panel: "folders" | "files"
	) {
		let parentPath: string;
		if (panel === "folders") {
			parentPath = this.getParentPath(targetPath);
		} else {
			parentPath = this.selectedFolderPath;
		}

		const orderKey = panel === "folders" ? `folders:${parentPath}` : `files:${parentPath}`;
		let currentOrder = this.plugin.settings.ordering[orderKey] || [];

		if (currentOrder.length === 0) {
			if (panel === "folders") {
				const parentFolder = parentPath === "/"
					? this.app.vault.getRoot()
					: this.app.vault.getAbstractFileByPath(parentPath);
				if (parentFolder instanceof TFolder) {
					currentOrder = parentFolder.children
						.filter((c): c is TFolder => c instanceof TFolder)
						.map((f) => f.path);
				}
			} else {
				currentOrder = this.getOrderedFiles(parentPath).map((f) => f.path);
			}
		}

		currentOrder = currentOrder.filter((p) => p !== draggedPath);

		let targetIndex = currentOrder.indexOf(targetPath);
		if (targetIndex === -1) {
			targetIndex = currentOrder.length;
		}

		if (!insertBefore) {
			targetIndex += 1;
		}
		currentOrder.splice(targetIndex, 0, draggedPath);

		this.plugin.settings.ordering[orderKey] = currentOrder;
		await this.plugin.saveSettings();
	}

	// ── ORDERING HELPERS ──

	private getOrderedFolders(parent: TFolder): TFolder[] {
		const folders = parent.children.filter((c): c is TFolder => c instanceof TFolder);
		const orderKey = `folders:${parent.path === "/" ? "/" : parent.path}`;
		const savedOrder = this.plugin.settings.ordering[orderKey];

		if (savedOrder && savedOrder.length > 0) {
			return this.applyOrder(folders, savedOrder, (f) => f.path);
		}

		return folders.sort((a, b) => a.name.localeCompare(b.name));
	}

	private getOrderedFiles(folderPath: string): TFile[] {
		const files = this.getFilesInFolder(folderPath);
		const sortMode = this.plugin.settings.sortMode;
		const asc = this.plugin.settings.sortAscending;
		const dir = asc ? 1 : -1;

		if (sortMode === "manual") {
			const orderKey = `files:${folderPath}`;
			const savedOrder = this.plugin.settings.ordering[orderKey];
			if (savedOrder && savedOrder.length > 0) {
				return this.applyOrder(files, savedOrder, (f) => f.path);
			}
			return files.sort((a, b) => b.stat.mtime - a.stat.mtime);
		}

		if (sortMode === "title") {
			return files.sort((a, b) => dir * a.basename.localeCompare(b.basename));
		}
		if (sortMode === "created") {
			return files.sort((a, b) => dir * (a.stat.ctime - b.stat.ctime));
		}
		return files.sort((a, b) => dir * (a.stat.mtime - b.stat.mtime));
	}

	private applyOrder<T>(items: T[], order: string[], getPath: (item: T) => string): T[] {
		const pathMap = new Map<string, T>();
		for (const item of items) {
			pathMap.set(getPath(item), item);
		}

		const ordered: T[] = [];

		for (const path of order) {
			const item = pathMap.get(path);
			if (item) {
				ordered.push(item);
				pathMap.delete(path);
			}
		}

		for (const item of pathMap.values()) {
			ordered.push(item);
		}

		return ordered;
	}

	private getFilesInFolder(folderPath: string): TFile[] {
		if (folderPath === "/") {
			const root = this.app.vault.getRoot();
			return root.children.filter((c): c is TFile => c instanceof TFile);
		}

		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (folder instanceof TFolder) {
			return folder.children.filter((c): c is TFile => c instanceof TFile);
		}
		return [];
	}

	private countFilesRecursive(folderPath: string): number {
		if (folderPath === "/") {
			return this.app.vault.getFiles().length;
		}
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (folder instanceof TFolder) {
			return this.countFolderFiles(folder);
		}
		return 0;
	}

	private countFolderFiles(folder: TFolder, depth: number = 0): number {
		if (depth > MAX_SUBFOLDER_DEPTH) return 0;
		let count = 0;
		for (const child of folder.children) {
			if (child instanceof TFile) {
				count++;
			} else if (child instanceof TFolder) {
				count += this.countFolderFiles(child, depth + 1);
			}
		}
		return count;
	}

	private folderHasSubfolders(path: string): boolean {
		if (path === "/") {
			const root = this.app.vault.getRoot();
			return root.children.some((c) => c instanceof TFolder);
		}
		const folder = this.app.vault.getAbstractFileByPath(path);
		if (folder instanceof TFolder) {
			return folder.children.some((c) => c instanceof TFolder);
		}
		return false;
	}

	// ── UTILITIES ──

	private getParentPath(path: string): string {
		if (path === "/") return "/";
		const parts = path.split("/");
		parts.pop();
		return parts.length === 0 ? "/" : parts.join("/");
	}

	private async loadPreview(file: TFile, el: HTMLElement) {
		try {
			const content = await this.app.vault.cachedRead(file);
			if (!el.isConnected) return;
			const lines = content.split("\n");
			let preview = "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---")) {
					preview = trimmed
						.replace(/\*\*(.*?)\*\*/g, "$1")
						.replace(/\*(.*?)\*/g, "$1")
						.replace(/__(.*?)__/g, "$1")
						.replace(/_(.*?)_/g, "$1")
						.replace(/`(.*?)`/g, "$1")
						.replace(/\[\[(.*?)\]\]/g, "$1")
						.replace(/\[(.*?)\]\(.*?\)/g, "$1");
					break;
				}
			}
			if (preview.length > 80) {
				preview = preview.substring(0, 80) + "...";
			}
			el.setText(preview || "Empty note");
		} catch {
			if (el.isConnected) el.setText("...");
		}
	}

	private formatDate(date: Date): string {
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffDays === 0 && diffMs >= 0) {
			return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		} else if (diffDays === 1) {
			return "Yesterday";
		} else if (diffDays > 0 && diffDays < 7) {
			return date.toLocaleDateString([], { weekday: "long" });
		} else {
			return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
		}
	}
}
