// Preloaded into local runs and tests: refuses any Node-level connection that is not
// loopback, so nothing here can reach mail, LLM, storage or other hosted services.
const net = require("net");

const original = net.Socket.prototype.connect;
const isLoopback = (host) => !host || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);

net.Socket.prototype.connect = function guardedConnect(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = first && typeof first === "object" ? first.host : typeof args[1] === "string" ? args[1] : undefined;
  const isPipe = first && typeof first === "object" && first.path;
  if (!isPipe && !isLoopback(host)) {
    const error = new Error("NETWORK_GUARD: blocked a connection to a non-loopback host");
    error.code = "ECONNREFUSED";
    process.nextTick(() => this.destroy(error));
    return this;
  }
  return original.apply(this, args);
};
