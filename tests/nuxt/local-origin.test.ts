// @vitest-environment node
// A browser-like environment (happy-dom) drops the forbidden `Origin` and `Host` headers
// of a `Request`, which is exactly what these tests send.
// Home-network sign-in for a phone (ADR 0036): which origins are trusted, and a
// real Better Auth instance driven through its handler like invite-code.test.ts.
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { createAuth } from '../../server/utils/auth'
import { localNetworkOrigin } from '../../server/utils/local-origin'

const PC = 'http://127.0.0.1:3737'
const PHONE_ORIGIN = 'http://192.168.1.20:3737'

function request(headers: Record<string, string>) {
  return new Request('http://example.invalid/api/auth/sign-in/email', { headers })
}

describe('localNetworkOrigin', () => {
  it.each([
    ['http://192.168.1.20:3737', '192.168.1.20:3737'],
    ['http://10.0.0.5:3737', '10.0.0.5:3737'],
    ['http://172.16.4.9:3737', '172.16.4.9:3737'],
    ['http://172.31.255.1:3737', '172.31.255.1:3737'],
    ['http://127.0.0.1:3737', '127.0.0.1:3737'],
  ])('trusts %s when it is the host asked', (origin, host) => {
    expect(localNetworkOrigin(request({ origin, host }))).toBe(origin)
  })

  it.each([
    ['another site', 'https://evil.example', '192.168.1.20:3737'],
    ['a public address', 'http://8.8.8.8:3737', '8.8.8.8:3737'],
    ['a name pointing at the PC (DNS rebinding)', 'http://evil.example:3737', 'evil.example:3737'],
    ['a name that looks like an address', 'http://192.168.1.20.evil.example:3737', '192.168.1.20.evil.example:3737'],
    ['172.32.x (outside the private range)', 'http://172.32.0.1:3737', '172.32.0.1:3737'],
    ['https', 'https://192.168.1.20:3737', '192.168.1.20:3737'],
    ['a private origin sent to another host', 'http://192.168.1.20:3737', '192.168.1.99:3737'],
    ['another port than the host', 'http://192.168.1.20:4000', '192.168.1.20:3737'],
  ])('does not trust %s', (_name, origin, host) => {
    expect(localNetworkOrigin(request({ origin, host }))).toBeNull()
  })

  it('has nothing to trust without an Origin, a Host or a request', () => {
    expect(localNetworkOrigin(request({ host: '192.168.1.20:3737' }))).toBeNull()
    expect(localNetworkOrigin(request({ origin: PHONE_ORIGIN }))).toBeNull()
    expect(localNetworkOrigin(undefined)).toBeNull()
    expect(localNetworkOrigin(request({ origin: 'not a url', host: 'x' }))).toBeNull()
  })
})

describe('sign-in from the home network', () => {
  function setup(trustLocalNetwork: boolean) {
    const db = drizzle(new Database(':memory:'), { schema })
    migrate(db, { migrationsFolder: './server/db/migrations' })
    const auth = createAuth({ db, secret: 'local-origin-test-secret-not-for-production', baseURL: PC, inviteCode: '', trustLocalNetwork })

    // Better Auth checks the Origin only on requests that carry a cookie (a browser
    // with a session); the cookie's value doesn't matter for that check.
    async function post(path: string, origin: string, host: string, body: Record<string, unknown>) {
      const response = await auth.handler(new Request(`http://${host}/api/auth/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, host, cookie: 'unrelated=1' },
        body: JSON.stringify(body),
      }))
      return response.status
    }
    return { post }
  }

  const account = { name: 'Phone', email: 'phone@example.com', password: 'a-fine-password' }

  it('lets the phone sign up and in on the PC\'s address', async () => {
    const { post } = setup(true)

    expect(await post('sign-up/email', PHONE_ORIGIN, '192.168.1.20:3737', account)).toBe(200)
    expect(await post('sign-in/email', PHONE_ORIGIN, '192.168.1.20:3737', { email: account.email, password: account.password })).toBe(200)
  })

  it('still refuses another site and a name for the PC', async () => {
    const { post } = setup(true)

    expect(await post('sign-up/email', 'https://evil.example', '192.168.1.20:3737', account)).toBe(403)
    expect(await post('sign-up/email', 'http://evil.example:3737', 'evil.example:3737', account)).toBe(403)
  })

  it('refuses the phone\'s address when the home network is not trusted (the default)', async () => {
    const { post } = setup(false)

    expect(await post('sign-up/email', PHONE_ORIGIN, '192.168.1.20:3737', account)).toBe(403)
  })

  it('keeps accepting the configured base URL either way', async () => {
    expect(await setup(true).post('sign-up/email', PC, '127.0.0.1:3737', account)).toBe(200)
    expect(await setup(false).post('sign-up/email', PC, '127.0.0.1:3737', account)).toBe(200)
  })
})
