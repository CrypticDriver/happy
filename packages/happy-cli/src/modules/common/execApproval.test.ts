import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { requestExecApproval } from './execApproval'

const sockets: string[] = []
const servers: net.Server[] = []

function makeApprover(reply: (req: any) => any): string {
    const socketPath = path.join(os.tmpdir(), `exec-approval-test-${process.pid}-${sockets.length}.sock`)
    const server = net.createServer((socket) => {
        let buffer = ''
        socket.on('data', (chunk) => {
            buffer += chunk.toString()
            if (!buffer.includes('\n')) return
            const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
            socket.write(JSON.stringify(reply(request)) + '\n')
        })
    })
    server.listen(socketPath)
    sockets.push(socketPath)
    servers.push(server)
    return socketPath
}

afterEach(() => {
    delete process.env.HAPPY_EXEC_APPROVER_SOCKET
    for (const server of servers.splice(0)) server.close()
    for (const socketPath of sockets.splice(0)) { try { fs.unlinkSync(socketPath) } catch { } }
})

describe('requestExecApproval', () => {
    it('approves everything when no approver socket is configured', async () => {
        delete process.env.HAPPY_EXEC_APPROVER_SOCKET
        const result = await requestExecApproval({ command: 'echo hi' })
        expect(result.approved).toBe(true)
    })

    it('approves when approver replies approve:true and passes the command through', async () => {
        let seen: any = null
        process.env.HAPPY_EXEC_APPROVER_SOCKET = makeApprover((req) => { seen = req; return { approve: true } })
        const result = await requestExecApproval({ command: 'git status', cwd: '/tmp' })
        expect(result.approved).toBe(true)
        expect(seen.type).toBe('exec-approval')
        expect(seen.command).toBe('git status')
        expect(seen.cwd).toBe('/tmp')
    })

    it('denies when approver replies approve:false', async () => {
        process.env.HAPPY_EXEC_APPROVER_SOCKET = makeApprover(() => ({ approve: false, reason: 'nope' }))
        const result = await requestExecApproval({ command: 'rm -rf /' })
        expect(result.approved).toBe(false)
        expect(result.reason).toBe('nope')
    })

    it('fails safe (deny) when the approver socket is unreachable', async () => {
        process.env.HAPPY_EXEC_APPROVER_SOCKET = path.join(os.tmpdir(), 'definitely-not-listening.sock')
        const result = await requestExecApproval({ command: 'echo hi' })
        expect(result.approved).toBe(false)
        expect(result.reason).toMatch(/unreachable/i)
    })

    it('denies on malformed approver response', async () => {
        const socketPath = path.join(os.tmpdir(), `exec-approval-test-malformed-${process.pid}.sock`)
        const server = net.createServer((socket) => { socket.write('not json\n') })
        server.listen(socketPath)
        sockets.push(socketPath)
        servers.push(server)
        process.env.HAPPY_EXEC_APPROVER_SOCKET = socketPath
        const result = await requestExecApproval({ command: 'echo hi' })
        expect(result.approved).toBe(false)
    })
})
