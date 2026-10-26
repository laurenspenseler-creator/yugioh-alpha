// Which browser origins Better Auth trusts when the app is shared inside the
// home network (the desktop app's "Mit Handy verbinden", ADR 0036). A phone
// reaches the PC by its LAN address, so its requests carry an `Origin` such as
// `http://192.168.1.20:3737`, which is not the configured base URL.
//
// Trusted only when all of these hold, so a page on another site can't borrow
// the user's session:
//  - the origin is plain `http` and a private IPv4 address written as digits,
//  - and it is exactly the `Host` the request was sent to.
// A domain name never qualifies, which also rules out DNS rebinding (a public
// name pointed at the PC's address).

const PRIVATE_IPV4 = /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/

export function localNetworkOrigin(request?: Request): string | null {
  const origin = request?.headers.get('origin')
  const host = request?.headers.get('host')
  if (!origin || !host) {
    return null
  }

  let url: URL
  try {
    url = new URL(origin)
  }
  catch {
    return null
  }
  if (url.protocol !== 'http:' || url.host !== host || !PRIVATE_IPV4.test(url.hostname)) {
    return null
  }
  return url.origin
}
