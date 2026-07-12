/**
 * `happy machine-exec` — execute a shell command on another machine of the
 * same Happy account, via the relay server.
 *
 * The daemon side already exposes a machine-scoped `bash` RPC handler
 * (see apiMachine.ts -> registerCommonHandlers). This command implements the
 * caller side, mirroring the mobile app's `machineRPC()` wire format:
 *
 *   socket.emitWithAck('rpc-call', {
 *     method: `${machineId}:bash`,
 *     params: encodeBase64(encrypt(machineKey, variant, { command, cwd, timeout }))
 *   }) -> { ok, result?, error? }   // result is encrypted the same way
 *
 * Security note: the target daemon executes the command without interactive
 * approval — access is gated by account credentials (the encryption key never
 * leaves the account's devices; the relay only sees ciphertext).
 */

import chalk from 'chalk'
import axios from 'axios'
import { io } from 'socket.io-client'

import { readCredentials } from '@/persistence'
import { configuration } from '@/configuration'
import { encrypt, decrypt, encodeBase64, decodeBase64 } from '@/api/encryption'

interface BashRequest {
    command: string
    cwd?: string
    timeout?: number
}

interface BashResponse {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export interface MachineExecArgs {
    list: boolean
    machine?: string
    cwd?: string
    timeout: number
    command?: string
}

export interface ResolvableMachine {
    id: string
    active?: boolean
    metadata: { host?: string; displayName?: string | null } | null
}

/** Server-side relay cap (RPC_CALL_TIMEOUT_MS) is 30s; stay under it. */
const DEFAULT_TIMEOUT_MS = 25_000
const MAX_TIMEOUT_MS = 29_000
/** Extra client-side grace on top of the requested command timeout. */
const CLIENT_GRACE_MS = 5_000

export function parseMachineExecArgs(args: string[]): MachineExecArgs {
    const parsed: MachineExecArgs = { list: false, timeout: DEFAULT_TIMEOUT_MS }

    let i = 0
    for (; i < args.length; i++) {
        const arg = args[i]
        if (arg === '--list') {
            parsed.list = true
        } else if (arg === '--machine' || arg === '-m') {
            const value = args[++i]
            if (!value) throw new Error('--machine requires a value')
            parsed.machine = value
        } else if (arg === '--cwd') {
            const value = args[++i]
            if (!value) throw new Error('--cwd requires a value')
            parsed.cwd = value
        } else if (arg === '--timeout') {
            const value = args[++i]
            const ms = Number(value)
            if (!value || !Number.isFinite(ms) || ms <= 0) throw new Error('--timeout requires a positive number (ms)')
            parsed.timeout = Math.min(ms, MAX_TIMEOUT_MS)
        } else if (arg === '--') {
            parsed.command = args.slice(i + 1).join(' ')
            break
        } else {
            throw new Error(`Unknown option: ${arg} (command must come after --)`)
        }
    }

    if (!parsed.list) {
        if (!parsed.machine) throw new Error('Missing --machine <id-or-name> (or use --list)')
        if (!parsed.command || parsed.command.trim().length === 0) {
            throw new Error('Missing command. Usage: happy machine-exec --machine <id> -- <command...>')
        }
    }
    return parsed
}

/**
 * Resolve a machine by exact id first, then by case-insensitive substring
 * match on id / metadata.host / metadata.displayName. Prefers online machines
 * when a substring matches several.
 */
export function resolveMachine<T extends ResolvableMachine>(machines: T[], query: string): T {
    const exact = machines.find(m => m.id === query)
    if (exact) return exact

    const q = query.toLowerCase()
    const matches = machines.filter(m =>
        m.id.toLowerCase().includes(q) ||
        (m.metadata?.host || '').toLowerCase().includes(q) ||
        (m.metadata?.displayName || '').toLowerCase().includes(q)
    )
    if (matches.length === 0) {
        throw new Error(`No machine matches "${query}". Run \`happy machine-exec --list\` to see machines.`)
    }
    if (matches.length > 1) {
        const online = matches.filter(m => m.active)
        if (online.length === 1) return online[0]
        const names = matches.map(m => `${m.id} (${m.metadata?.host || 'unknown host'})`).join(', ')
        throw new Error(`Ambiguous machine "${query}" matches: ${names}. Use the full machine id.`)
    }
    return matches[0]
}

function resolveEncryption(credentials: NonNullable<Awaited<ReturnType<typeof readCredentials>>>): { key: Uint8Array; variant: 'legacy' | 'dataKey' } {
    if (credentials.encryption.type === 'dataKey') {
        return { key: credentials.encryption.machineKey, variant: 'dataKey' }
    }
    return { key: credentials.encryption.secret, variant: 'legacy' }
}

async function fetchMachines(token: string, key: Uint8Array, variant: 'legacy' | 'dataKey'): Promise<ResolvableMachine[]> {
    const response = await axios.get(`${configuration.serverUrl}/v1/machines`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'X-Happy-Client': `cli-machine-exec/${configuration.currentCliVersion}`
        },
        timeout: 30_000
    })
    const rows = response.data as { id: string; metadata: string | null; active?: boolean }[]
    return rows.map(row => {
        let metadata: ResolvableMachine['metadata'] = null
        if (row.metadata) {
            try {
                metadata = decrypt(key, variant, decodeBase64(row.metadata))
            } catch {
                metadata = null // machine registered with a different key; can't target it anyway
            }
        }
        return { id: row.id, active: row.active, metadata }
    })
}

function callBashRpc(opts: {
    token: string
    key: Uint8Array
    variant: 'legacy' | 'dataKey'
    machineId: string
    request: BashRequest
    waitMs: number
}): Promise<BashResponse> {
    return new Promise<BashResponse>((resolve, reject) => {
        const socket = io(configuration.serverUrl, {
            transports: ['websocket'],
            auth: {
                token: opts.token,
                clientType: 'user-scoped' as const,
                happyClient: `cli-machine-exec/${configuration.currentCliVersion}`
            },
            path: '/v1/updates',
            reconnection: false,
        })

        let settled = false
        const finish = (fn: () => void) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            socket.disconnect()
            fn()
        }

        const timer = setTimeout(() => {
            finish(() => reject(new Error(`Timed out after ${opts.waitMs}ms waiting for machine ${opts.machineId}`)))
        }, opts.waitMs)

        socket.on('connect_error', (error) => {
            finish(() => reject(new Error(`Failed to connect to ${configuration.serverUrl}: ${error.message}`)))
        })

        socket.on('connect', async () => {
            try {
                const ack = await socket.emitWithAck('rpc-call', {
                    method: `${opts.machineId}:bash`,
                    params: encodeBase64(encrypt(opts.key, opts.variant, opts.request))
                }) as { ok: boolean; result?: string; error?: string }

                if (!ack.ok) {
                    finish(() => reject(new Error(ack.error || 'RPC call failed (is the daemon running on the target machine?)')))
                    return
                }
                const decrypted = decrypt(opts.key, opts.variant, decodeBase64(ack.result!)) as BashResponse | { error: string }
                if (decrypted && typeof decrypted === 'object' && 'error' in decrypted && !('success' in decrypted)) {
                    finish(() => reject(new Error((decrypted as { error: string }).error)))
                    return
                }
                finish(() => resolve(decrypted as BashResponse))
            } catch (error) {
                finish(() => reject(error instanceof Error ? error : new Error(String(error))))
            }
        })
    })
}

export async function handleMachineExecCommand(args: string[]): Promise<void> {
    let parsed: MachineExecArgs
    try {
        parsed = parseMachineExecArgs(args)
    } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error))
        console.error(`
Usage:
  happy machine-exec --list
  happy machine-exec --machine <id-or-name> [--cwd <path>] [--timeout <ms>] -- <command...>
`)
        process.exit(1)
        return
    }

    const credentials = await readCredentials()
    if (!credentials) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run `happy` first to log in.')
        process.exit(1)
        return
    }
    const { key, variant } = resolveEncryption(credentials)

    if (parsed.list) {
        const machines = await fetchMachines(credentials.token, key, variant)
        if (machines.length === 0) {
            console.log('No machines registered on this account.')
            return
        }
        for (const machine of machines) {
            const host = machine.metadata?.displayName || machine.metadata?.host || '(unknown host)'
            const status = machine.active ? chalk.green('online') : chalk.gray('offline')
            console.log(`${machine.id}  ${host}  ${status}`)
        }
        return
    }

    const machines = await fetchMachines(credentials.token, key, variant)
    const machine = resolveMachine(machines, parsed.machine!)

    const request: BashRequest = {
        command: parsed.command!,
        cwd: parsed.cwd,
        timeout: parsed.timeout
    }

    try {
        const result = await callBashRpc({
            token: credentials.token,
            key,
            variant,
            machineId: machine.id,
            request,
            waitMs: parsed.timeout + CLIENT_GRACE_MS
        })
        console.log(JSON.stringify({
            success: result.success === true,
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
            exitCode: result.exitCode ?? (result.success ? 0 : 1),
            ...(result.error ? { error: result.error } : {})
        }, null, 2))
        process.exit(result.success === true ? 0 : 1)
    } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error))
        process.exit(1)
    }
}
