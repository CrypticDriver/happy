import { describe, it, expect } from 'vitest'
import { parseMachineExecArgs, resolveMachine, type ResolvableMachine } from './machineExec'

describe('parseMachineExecArgs', () => {
    it('parses --list', () => {
        expect(parseMachineExecArgs(['--list']).list).toBe(true)
    })

    it('parses machine + command after --', () => {
        const parsed = parseMachineExecArgs(['--machine', 'mac', '--', 'echo', 'hello world'])
        expect(parsed.machine).toBe('mac')
        expect(parsed.command).toBe('echo hello world')
    })

    it('parses cwd and timeout, capping timeout below relay limit', () => {
        const parsed = parseMachineExecArgs(['--machine', 'm1', '--cwd', '/tmp', '--timeout', '60000', '--', 'ls'])
        expect(parsed.cwd).toBe('/tmp')
        expect(parsed.timeout).toBeLessThanOrEqual(29_000)
    })

    it('rejects missing command', () => {
        expect(() => parseMachineExecArgs(['--machine', 'm1'])).toThrow(/Missing command/)
    })

    it('rejects missing machine', () => {
        expect(() => parseMachineExecArgs(['--', 'ls'])).toThrow(/--machine/)
    })

    it('rejects unknown options', () => {
        expect(() => parseMachineExecArgs(['--frobnicate'])).toThrow(/Unknown option/)
    })

    it('rejects invalid timeout', () => {
        expect(() => parseMachineExecArgs(['--machine', 'm1', '--timeout', 'abc', '--', 'ls'])).toThrow(/timeout/)
    })
})

describe('resolveMachine', () => {
    const machines: ResolvableMachine[] = [
        { id: 'cmid-aaaa', active: true, metadata: { host: 'MacBook-Pro.local', displayName: null } },
        { id: 'cmid-bbbb', active: false, metadata: { host: 'ip-10-0-1-80', displayName: 'goudan-server' } },
        { id: 'cmid-cccc', active: false, metadata: null },
    ]

    it('resolves by exact id', () => {
        expect(resolveMachine(machines, 'cmid-cccc').id).toBe('cmid-cccc')
    })

    it('resolves by host substring, case-insensitive', () => {
        expect(resolveMachine(machines, 'macbook').id).toBe('cmid-aaaa')
    })

    it('resolves by displayName substring', () => {
        expect(resolveMachine(machines, 'goudan').id).toBe('cmid-bbbb')
    })

    it('prefers the online machine when substring is ambiguous', () => {
        expect(resolveMachine(machines, 'cmid').id).toBe('cmid-aaaa')
    })

    it('throws for no match', () => {
        expect(() => resolveMachine(machines, 'windows')).toThrow(/No machine matches/)
    })

    it('throws for ambiguous match among offline machines', () => {
        const offline = machines.map(m => ({ ...m, active: false }))
        expect(() => resolveMachine(offline, 'cmid')).toThrow(/Ambiguous/)
    })
})
