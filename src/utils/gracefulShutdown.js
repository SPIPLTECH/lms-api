/**
 * What happens when the platform stops the API (Render sends SIGTERM on every deploy and
 * restart; Docker on `docker stop`): stop taking requests, save what is still waiting in
 * memory, stop the AI process, then exit. Each step is independent, so one failing does not
 * stop the rest, and a deadline makes sure the process always exits before it is killed.
 */

const DEFAULT_DEADLINE_MS = 25 * 1000;

function createShutdown({ server, steps, deadlineMs = DEFAULT_DEADLINE_MS, exit = (code) => process.exit(code), log = console.log }) {
  let running = null;

  async function runSteps() {
    // No new connections from here on. Not awaited: open sockets and the exam notices' long
    // polls would hold it for their whole wait, and they end anyway when the process exits.
    try {
      server.close();
      server.closeIdleConnections?.();
    } catch {
      // Already closed.
    }
    for (const [name, step] of steps) {
      try {
        await step();
        log(`[shutdown] ${name}: done`);
      } catch (error) {
        log(`[shutdown] ${name}: failed (${error?.message})`);
      }
    }
  }

  return function shutdown(signal) {
    if (running) return running;
    log(`[shutdown] ${signal} received; saving what is waiting before exit.`);
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve("deadline"), deadlineMs);
      timer.unref?.();
    });
    running = Promise.race([runSteps().then(() => "done"), deadline]).then((outcome) => {
      clearTimeout(timer);
      if (outcome === "deadline") log(`[shutdown] not finished after ${deadlineMs} ms; exiting anyway.`);
      exit(outcome === "done" ? 0 : 1);
    });
    return running;
  };
}

module.exports = { createShutdown };
