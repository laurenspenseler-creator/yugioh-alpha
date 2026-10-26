import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { useDb } from '../db'
import * as schema from '../db/schema'
import { inviteCodeGate } from './invite-code'
import { localNetworkOrigin } from './local-origin'

export interface CreateAuthOptions {
  db: BetterSQLite3Database<typeof schema>
  secret: string
  baseURL: string
  /** Shared sign-up invite code (ADR 0027); '' = open sign-up. */
  inviteCode: string
  /** Also trust requests from the home network's private addresses (desktop app, ADR 0036). */
  trustLocalNetwork?: boolean
}

export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    database: drizzleAdapter(options.db, {
      provider: 'sqlite',
      schema,
    }),
    secret: options.secret,
    baseURL: options.baseURL,
    // Better Auth switches the origin check off in a test run; keep it on, so
    // tests see what production does (it is the default there anyway).
    advanced: { disableOriginCheck: false },
    ...(options.trustLocalNetwork ? { trustedOrigins: async (request?: Request) => [localNetworkOrigin(request)] } : {}),
    emailAndPassword: {
      enabled: true,
    },
    hooks: {
      before: inviteCodeGate(options.inviteCode),
    },
  })
}

let authInstance: ReturnType<typeof createAuth> | undefined

/**
 * Singleton Better Auth instance, configured for email/password auth
 * over the SQLite/Drizzle database.
 */
export function useAuth() {
  if (!authInstance) {
    const config = useRuntimeConfig()
    authInstance = createAuth({
      db: useDb(),
      secret: config.betterAuthSecret,
      baseURL: config.public.betterAuthUrl,
      inviteCode: config.inviteCode,
      // `NUXT_TRUST_LOCAL_NETWORK=true`; Nitro turns the env string into a boolean, a literal 'true' is kept as well.
      trustLocalNetwork: (config.trustLocalNetwork as unknown) === true || (config.trustLocalNetwork as unknown) === 'true',
    })
  }
  return authInstance
}
