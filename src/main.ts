import { Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { SpineView } from "./SpineView";
import { DEFAULT_SETTINGS, SpineSettings, VIEW_TYPE_SPINE } from "./types";

export default class SpinePlugin extends Plugin {
	settings: SpineSettings;

	async onload() {
		await this.loadSettings();

		// Register the custom view
		this.registerView(VIEW_TYPE_SPINE, (leaf: WorkspaceLeaf) => {
			return new SpineView(leaf, this);
		});

		// Add ribbon icon to open the panel
		this.addRibbonIcon("columns-2", "Spine", () => {
			this.activateView();
		});

		// Add command to open the panel
		this.addCommand({
			id: "open-spine-browser",
			name: "Open Spine",
			callback: () => {
				this.activateView();
			},
		});

		// Listen for vault changes to refresh the view
		this.registerEvent(this.app.vault.on("create", () => this.refreshView()));
		this.registerEvent(this.app.vault.on("delete", () => this.refreshView()));
		this.registerEvent(this.app.vault.on("rename", () => this.refreshView()));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_SPINE);
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_SPINE);

		if (leaves.length > 0) {
			leaf = leaves[0]!;
		} else {
			leaf = workspace.getLeftLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_SPINE,
					active: true,
				});
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	refreshView() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SPINE);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof SpineView) {
				view.refresh();
			}
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SpineSettings>
		);

		// Validate lastSelectedFolder still exists
		if (
			this.settings.lastSelectedFolder !== "/" &&
			!this.app.vault.getAbstractFileByPath(this.settings.lastSelectedFolder)
		) {
			this.settings.lastSelectedFolder = "/";
		}

		// Clean up orphaned ordering entries
		this.cleanOrdering();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Remove ordering entries that reference files/folders that no longer exist.
	 * This prevents unbounded growth of the ordering data.
	 */
	private cleanOrdering() {
		const ordering = this.settings.ordering;
		let changed = false;

		for (const key of Object.keys(ordering)) {
			const paths = ordering[key];
			if (!paths) continue;

			const cleaned = paths.filter((p) => {
				return this.app.vault.getAbstractFileByPath(p) !== null;
			});

			if (cleaned.length !== paths.length) {
				changed = true;
				if (cleaned.length === 0) {
					delete ordering[key];
				} else {
					ordering[key] = cleaned;
				}
			}
		}

		if (changed) {
			// Save async — non-critical, best effort
			this.saveSettings();
		}
	}
}
