// `pnpm dev:phone`: the dev server on the home network, so a phone on the same
// Wi-Fi can open the app being built (tester feedback, round 2). Like the desktop
// app's "Mit Handy verbinden" (ADR 0036) it listens on every interface and trusts
// sign-in requests from the private address it was reached by
// (NUXT_TRUST_LOCAL_NETWORK); that setting is for development at home, never for
// a public host.
import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'

const port = process.env.PORT || '3000'

// Home routers hand out 192.168.x.x or 10.x.x.x; 172.16-31 also shows up for
// virtual adapters (WSL, Hyper-V), so those come last.
const rank = address => (address.startsWith('192.168.') ? 0 : address.startsWith('10.') ? 1 : 2)
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter(entry => entry && entry.family === 'IPv4' && !entry.internal && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(entry.address))
  .map(entry => entry.address)
  .sort((a, b) => rank(a) - rank(b))

console.log('')
console.log('YGO Alpha für das Handy (Entwicklungsserver)')
console.log('--------------------------------------------')
if (addresses.length === 0) {
  console.log('Keine Heimnetz-Adresse gefunden. Ist der Laptop mit dem WLAN verbunden?')
}
else {
  console.log('Öffne auf dem Handy (im selben WLAN) im Browser:')
  for (const address of addresses) {
    console.log(`  http://${address}:${port}`)
  }
  console.log('Meist ist die erste Adresse die richtige.')
}
console.log('Beim ersten Start fragt die Windows-Firewall, ob Node im privaten Netzwerk erlaubt sein soll: Zugriff zulassen.')
console.log('')

// `::` is every interface, IPv4 and IPv6 in one listener. With `0.0.0.0` the dev server also
// opened a second, IPv6-only listener that answers every request with "426 Upgrade Required",
// and a browser that resolves `localhost` to ::1 (Chrome, the preview pane) landed on that one.
const child = spawn('pnpm', ['exec', 'nuxt', 'dev', '--host', '::', '--port', port], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NUXT_TRUST_LOCAL_NETWORK: 'true' },
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', code => process.exit(code ?? 0))
