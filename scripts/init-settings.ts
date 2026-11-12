import { writeFile } from "node:fs/promises";
import { M1SettingsSchema } from "../src/settings/schema";
import { SETTINGS_FILE } from "../src/settings/load";

await writeFile(SETTINGS_FILE, JSON.stringify(M1SettingsSchema.parse({}), null, 2) + "\n");
console.log(`wrote ${SETTINGS_FILE}`);
