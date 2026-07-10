import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// configuration.happyHomeDir is read once at module load from HAPPY_HOME_DIR.
// Point it at a fresh scratch dir before importing sessionLineage so every
// test run is isolated and never touches the real ~/.happy.
let tmpHome: string;
tmpHome = mkdtempSync(join(tmpdir(), 'happy-lineage-test-'));
process.env.HAPPY_HOME_DIR = tmpHome;

const { lookupTag, recordSid } = await import('./sessionLineage');

describe('sessionLineage', () => {
    afterEach(() => {
        const filePath = join(tmpHome, 'session-lineage.json');
        if (existsSync(filePath)) {
            rmSync(filePath);
        }
    });

    it('returns null for an unknown Claude session id', () => {
        expect(lookupTag('never-seen-sid')).toBeNull();
    });

    it('round-trips a recorded mapping', () => {
        recordSid('claude-sid-1', 'happy-tag-1');
        expect(lookupTag('claude-sid-1')).toBe('happy-tag-1');
    });

    it('re-parents an existing tag to a new Claude session id without losing other entries', () => {
        recordSid('claude-sid-1', 'happy-tag-1');
        recordSid('claude-sid-2', 'happy-tag-2');
        // Simulate /compact or a fork minting a new Claude session id for
        // the same Happy tag.
        recordSid('claude-sid-1-forked', 'happy-tag-1');

        expect(lookupTag('claude-sid-1')).toBe('happy-tag-1');
        expect(lookupTag('claude-sid-1-forked')).toBe('happy-tag-1');
        expect(lookupTag('claude-sid-2')).toBe('happy-tag-2');
    });

    it('persists to session-lineage.json as flat JSON', () => {
        recordSid('claude-sid-x', 'happy-tag-x');
        const filePath = join(tmpHome, 'session-lineage.json');
        expect(existsSync(filePath)).toBe(true);
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        expect(parsed['claude-sid-x']).toBe('happy-tag-x');
    });

    it('ignores empty claudeSid or tag arguments', () => {
        recordSid('', 'happy-tag-y');
        recordSid('claude-sid-y', '');
        expect(lookupTag('claude-sid-y')).toBeNull();
    });

    it('lookupTag returns null for an empty id', () => {
        expect(lookupTag('')).toBeNull();
    });
});
