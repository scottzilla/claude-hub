import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_DIR } from "./auth.js";
const EVENTS_DIR = join(AGENT_DIR, "events");
export async function pollEvents(types) {
    let files;
    try {
        files = await readdir(EVENTS_DIR);
    }
    catch {
        return [];
    }
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
    const events = [];
    for (const file of jsonFiles) {
        const path = join(EVENTS_DIR, file);
        try {
            const raw = await readFile(path, "utf-8");
            const event = JSON.parse(raw);
            if (types && types.length > 0 && !types.includes(event.type)) {
                continue;
            }
            events.push(event);
            await unlink(path);
        }
        catch {
            // skip malformed files
        }
    }
    return events;
}
export async function getEventStats() {
    let files;
    try {
        files = await readdir(EVENTS_DIR);
    }
    catch {
        return { pendingCount: 0, lastEventTime: null };
    }
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
    const pendingCount = jsonFiles.length;
    let lastEventTime = null;
    if (jsonFiles.length > 0) {
        const lastFile = jsonFiles[jsonFiles.length - 1];
        const ms = parseInt(lastFile.split("-")[0], 10);
        if (!isNaN(ms)) {
            lastEventTime = new Date(ms).toISOString();
        }
    }
    return { pendingCount, lastEventTime };
}
