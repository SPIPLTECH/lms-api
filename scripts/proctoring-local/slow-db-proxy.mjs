/**
 * A loopback TCP proxy in front of the disposable database that adds delay to every packet, so a
 * local measurement sees what the hosted database costs (about 100 ms a round trip) without
 * going near it.
 *
 *   node scripts/proctoring-local/slow-db-proxy.mjs [--listen=54362] [--target=54361] [--one-way-ms=50]
 */
import net from "node:net";

const option = (name, fallback) => Number(process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const LISTEN = option("listen", 54362);
const TARGET = option("target", 54361);
const DELAY_MS = option("one-way-ms", 50);

/** Forwards chunks after the delay, in order. Ends only after everything queued has gone. */
function delayed(from, to) {
  from.on("data", (chunk) => setTimeout(() => to.writable && to.write(chunk), DELAY_MS));
  from.on("end", () => setTimeout(() => to.end(), DELAY_MS));
  from.on("error", () => to.destroy());
}

net
  .createServer((client) => {
    const server = net.connect(TARGET, "127.0.0.1");
    client.setNoDelay(true);
    server.setNoDelay(true);
    delayed(client, server);
    delayed(server, client);
  })
  .listen(LISTEN, "127.0.0.1", () => console.log(`[slow-db-proxy] 127.0.0.1:${LISTEN} -> 127.0.0.1:${TARGET}, ${DELAY_MS} ms each way`));
