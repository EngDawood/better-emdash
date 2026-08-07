/**
 * Admin entry point for the jobs-board plugin.
 * Wired in `astro.config.mjs` via `adminEntry`.
 */

import type { PluginAdminExports } from "emdash";
import { JobsPage } from "./components/JobsPage";
import { SettingsPage } from "./components/SettingsPage";

export const pages: PluginAdminExports["pages"] = {
	"/": JobsPage as any,
	"/settings": SettingsPage as any,
};
