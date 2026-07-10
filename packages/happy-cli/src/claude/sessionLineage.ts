/**
 * Session lineage: maps Claude Code session IDs to the stable Happy `tag`
 * used with `getOrCreateSession`, so that when Claude crashes/exits and a
 * caller later does `claude --resume <sid>`, the resulting Happy session
 * reuses the *same* server-side session (get-or-create by tag) instead of
 * minting a fresh one via `randomUUID()`. This keeps the chat title,
 * history, and app-side session entry stable across a crash + resume.
 *
 * Storage: `~/.happy/session-lineage.json`, a flat JSON map of
 * `{ [claudeSessionId]: happyTag }`. Written atomically (write to a temp
 * file in the same directory, then rename) so a crash mid-write can't
 * corrupt the file. Reads that fail (missing file, invalid JSON) return
 * an empty map rather than throwing — lineage tracking is a nice-to-have,
 * never a hard dependency for starting a session.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

type LineageMap = Record<string, string>;

function lineageFilePath(): string {
    return join(configuration.happyHomeDir, 'session-lineage.json');
}

function readLineageMap(): LineageMap {
    const filePath = lineageFilePath();
    try {
        if (!existsSync(filePath)) return {};
        const raw = readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as LineageMap;
        }
        return {};
    } catch (error) {
        logger.debug('[sessionLineage] Failed to read lineage file, treating as empty', error);
        return {};
    }
}

function writeLineageMap(map: LineageMap): void {
    const filePath = lineageFilePath();
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    try {
        writeFileSync(tmpPath, JSON.stringify(map, null, 2), 'utf8');
        renameSync(tmpPath, filePath);
    } catch (error) {
        logger.debug('[sessionLineage] Failed to write lineage file', error);
    }
}

/**
 * Look up the Happy session tag previously recorded for a Claude session ID.
 * Returns null if there is no recorded mapping (fresh session, or lineage
 * file unreadable).
 */
export function lookupTag(claudeSid: string): string | null {
    if (!claudeSid) return null;
    const map = readLineageMap();
    return map[claudeSid] ?? null;
}

/**
 * Record that a given Claude session ID is associated with a Happy tag.
 * Safe to call repeatedly with the same pair (idempotent); safe to call
 * with a new Claude session ID for an existing tag (re-parenting after
 * /compact or a fork, so the lineage chain doesn't break).
 */
export function recordSid(claudeSid: string, tag: string): void {
    if (!claudeSid || !tag) return;
    const map = readLineageMap();
    if (map[claudeSid] === tag) return; // no-op, avoid needless disk write
    map[claudeSid] = tag;
    writeLineageMap(map);
}
