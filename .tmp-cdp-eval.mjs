// Connects to the Node inspector of the already-running nexus-desktop main
// process (enabled via SIGUSR1, no restart) and runs an arbitrary JS
// expression there via Runtime.evaluate, printing the result.
import WebSocket from 'ws'

const wsUrl = process.argv[2]
const expression = process.argv[3]

const ws = new WebSocket(wsUrl)
let id = 1

function send(method, params) {
  const msgId = id++
  ws.send(JSON.stringify({ id: msgId, method, params }))
  return msgId
}

ws.on('open', () => {
  send('Runtime.enable', {})
  send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 30000 })
})

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString())
  if (msg.id === 2) {
    console.log(JSON.stringify(msg.result, null, 2))
    ws.close()
    process.exit(0)
  }
})

ws.on('error', (e) => {
  console.error('WS error:', e)
  process.exit(1)
})

setTimeout(() => {
  console.error('Timeout waiting for evaluation result.')
  process.exit(1)
}, 35000)
