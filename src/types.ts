// Persistent ordering data saved via plugin.saveData()
export interface OrderingData {
	// Maps a folder path to an ordered array of child paths (both folders and files)
	[folderPath: string]: string[];
}

export type SortMode = "manual" | "title" | "modified" | "created";

export interface SpineSettings {
	ordering: OrderingData;
	lastSelectedFolder: string;
	showFileExtensions: boolean;
	sortMode: SortMode;
	sortAscending: boolean;
	folderColumnWidth: number | null;
}

export const DEFAULT_SETTINGS: SpineSettings = {
	ordering: {},
	lastSelectedFolder: "/",
	showFileExtensions: false,
	sortMode: "manual",
	sortAscending: true,
	folderColumnWidth: null,
};

export const VIEW_TYPE_SPINE = "spine-file-browser-view";
