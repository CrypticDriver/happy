/**
 * Persists attachments that Claude's image API can't accept (anything that
 * doesn't match one of the four magic-byte signatures detectClaudeImageMime
 * recognizes) to a working-directory scratch folder, so the file is at
 * least available to Claude via normal filesystem tools (Read/Glob/etc)
 * instead of being silently dropped.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { PendingAttachment } from '@/utils/MessageQueue2';

export const NON_IMAGE_UPLOAD_DIRNAME = '.happy-uploads';

/**
 * Strip path separators, `..` traversal segments, and other characters that
 * could escape the upload directory or confuse a shell/tool downstream.
 * Never trust the wire-supplied attachment name for path construction.
 */
export function sanitizeAttachmentFilename(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? name;
    const sanitized = base
        .trim()
        .replace(/\.+/g, '.')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/^\.+/, '')
        .replace(/^_+|_+$/g, '');
    return sanitized.length > 0 ? sanitized : 'file';
}

/**
 * Pick a filename inside `dir` that does not collide with an existing file.
 * On collision, insert a millisecond timestamp before the extension
 * (or at the end, if there is no extension).
 */
function resolveNonCollidingPath(dir: string, filename: string): string {
    const candidate = join(dir, filename);
    if (!existsSync(candidate)) {
        return candidate;
    }
    const dotIndex = filename.lastIndexOf('.');
    const stamp = Date.now();
    const stamped = dotIndex > 0
        ? `${filename.slice(0, dotIndex)}-${stamp}${filename.slice(dotIndex)}`
        : `${filename}-${stamp}`;
    return join(dir, stamped);
}

export type SavedNonImageAttachment = {
    /** Path relative to the working directory, e.g. ".happy-uploads/report.pdf" */
    relativePath: string;
    absolutePath: string;
    size: number;
};

/**
 * Write a non-image attachment's decrypted bytes to `<cwd>/.happy-uploads/`.
 * Creates the directory if needed. Returns the path (relative to cwd) that
 * should be surfaced to Claude in the message text.
 */
export function saveNonImageAttachment(
    att: PendingAttachment,
    cwd: string = process.cwd(),
): SavedNonImageAttachment {
    const uploadsDir = join(cwd, NON_IMAGE_UPLOAD_DIRNAME);
    mkdirSync(uploadsDir, { recursive: true });

    const safeName = sanitizeAttachmentFilename(att.name);
    const absolutePath = resolveNonCollidingPath(uploadsDir, safeName);
    writeFileSync(absolutePath, att.data);

    return {
        relativePath: join(NON_IMAGE_UPLOAD_DIRNAME, absolutePath.slice(uploadsDir.length + 1)),
        absolutePath,
        size: att.data.length,
    };
}
