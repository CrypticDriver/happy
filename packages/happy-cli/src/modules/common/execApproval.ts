/**
 * Optional approval gate for machine-scoped exec RPCs.
 *
 * When HAPPY_EXEC_APPROVER_SOCKET is set (unix socket path), every bash RPC
 * must be approved by the approver process (e.g. the Happy desktop app, which
 * shows a native confirmation dialog). Protocol: newline-delimited JSON.
 *
 *   -> { "type": "exec-approval", "command": string, "cwd"?: string, "timeout"?: number }
 *   <- { "approve": boolean }
 *
 * Fail-safe: if the socket is unreachable or does not answer in time, the
 * command is DENIED (we never silently fall back to unapproved execution).
 */

import net from 'node:net'

export interface ExecApprovalRequest {
    type: 'exec-approval'
    command: string
    cwd?: string
    timeout?: number
}

const APPROVAL_WAIT_MS = 120_000

export function approvalSocketPath(): string | undefined {
    const p = process.env.HAPPY_EXEC_APPROVER_SOCKET
    return p && p.trim().length > 0 ? p : undefined
}

export function requestExecApproval(request: Omit<ExecApprovalRequest, 'type'>): Promise<{ approved: boolean; reason?: string }> {
    const socketPath = approvalSocketPath()
    if (!socketPath) {
        return Promise.resolve({ approved: true })
    }

    return new Promise((resolve) => {
        let settled = false
        const finish = (approved: boolean, reason?: string) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            socket.destroy()
            resolve({ approved, reason })
        }

        const socket = net.createConnection(socketPath)
        const timer = setTimeout(() => finish(false, 'Approval timed out'), APPROVAL_WAIT_MS)

        socket.on('error', (error) => finish(false, `Approver unreachable: ${error.message}`))

        let buffer = ''
        socket.on('data', (chunk) => {
            buffer += chunk.toString()
            const newline = buffer.indexOf('\n')
            if (newline === -1) return
            try {
                const response = JSON.parse(buffer.slice(0, newline)) as { approve?: boolean; reason?: string }
                finish(response.approve === true, response.reason)
            } catch {
                finish(false, 'Malformed approver response')
            }
        })

        socket.on('connect', () => {
            const payload: ExecApprovalRequest = { type: 'exec-approval', ...request }
            socket.write(JSON.stringify(payload) + '\n')
        })
    })
}
