/**
 * Session lineage: maps Claude Code session IDs to the stable Happy `tag`
 * used with `getOrCreateSession`, so that when Claude crashes/exits and a
 * caller later does `claude --resume <sid>`, the resulting Happy session
 * reuses the *same* server-side session (get-or-create by tag) instead of
 * minting a fresh one via `randomUUID()`. This keeps the chat title,
 * history, and app-side session entry stable across a crash + resume.
 *
 * Storage: `~/.happy/session-lineage.json`, a flat JSON map of
 * `{ [claudeSessionId]: happyTag | { tag, dataKey } }`. `dataKey` (base64)
 * is recorded for dataKey-variant sessions so a resume can re-open the
 * existing server row with the same content encryption key — without it,
 * getOrCreateSession would mint a fresh random key and fail to decrypt the
 * existing row's metadata (the account secret lives only in the app).
 * Written atomically (write to a temp
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

type LineageEntry = string | { tag: string; dataKey?: string };
type LineageMap = Record<string, LineageEntry>;

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
    return lookupLineage(claudeSid)?.tag ?? null;
}

/**
 * Look up the full lineage entry (tag + optional session data key) for a
 * Claude session ID. `dataKey` is only present for dataKey-variant sessions
 * recorded by newer CLI versions; legacy string entries yield dataKey null.
 */
export function lookupLineage(claudeSid: string): { tag: string; dataKey: Uint8Array | null } | null {
    if (!claudeSid) return null;
    const map = readLineageMap();
    const entry = map[claudeSid];
    if (!entry) return null;
    if (typeof entry === 'string') {
        return { tag: entry, dataKey: null };
    }
    if (!entry.tag) return null;
    let dataKey: Uint8Array | null = null;
    if (entry.dataKey) {
        try {
            dataKey = new Uint8Array(Buffer.from(entry.dataKey, 'base64'));
        } catch {
            dataKey = null;
        }
    }
    return { tag: entry.tag, dataKey };
}

/**
 * Record that a given Claude session ID is associated with a Happy tag.
 * Safe to call repeatedly with the same pair (idempotent); safe to call
 * with a new Claude session ID for an existing tag (re-parenting after
 * /compact or a fork, so the lineage chain doesn't break).
 *
 * `dataKey` should ONLY be provided for dataKey-variant sessions (a fresh
 * per-session content key). Never pass the account-wide legacy secret here.
 */
export function recordSid(claudeSid: string, tag: string, dataKey?: Uint8Array | null): void {
    if (!claudeSid || !tag) return;
    const map = readLineageMap();
    const existing = map[claudeSid];
    const existingTag = typeof existing === 'string' ? existing : existing?.tag;
    const existingDataKey = typeof existing === 'string' ? undefined : existing?.dataKey;
    const nextDataKey = dataKey ? Buffer.from(dataKey).toString('base64') : existingDataKey;
    if (existingTag === tag && existingDataKey === nextDataKey) return; // no-op, avoid needless disk write
    map[claudeSid] = nextDataKey ? { tag, dataKey: nextDataKey } : tag;
    writeLineageMap(map);
}
