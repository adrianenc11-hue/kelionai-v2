// ═══════════════════════════════════════════════════════════════
// KelionAI — Cluster Mode + Performance Bootstrap
// Uses ALL CPU cores via Node.js cluster module
// Master process: manages workers, restarts on crash
// Worker process: runs the Express server
// ═══════════════════════════════════════════════════════════════
"use strict";

const cluster = require("cluster");
const os = require("os");

const MAX_WORKERS =
  parseInt(process.env.CLUSTER_WORKERS || "0", 10) ||
  Math.min(os.cpus().length, 4);
const RESTART_DELAY = 2000; // ms before restarting crashed worker

if (cluster.isPrimary || cluster.isMaster) {
  console.log(
    `[Cluster] 🚀 Master PID ${process.pid} — spawning ${MAX_WORKERS} workers`,
  );

  // Fork workers
  for (let i = 0; i < MAX_WORKERS; i++) {
    cluster.fork();
  }

  // Restart crashed workers
  cluster.on("exit", (worker, code, signal) => {
    console.log(
      `[Cluster] ⚠️ Worker ${worker.process.pid} died (${signal || code}). Restarting in ${RESTART_DELAY}ms...`,
    );
    setTimeout(() => cluster.fork(), RESTART_DELAY);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("[Cluster] SIGTERM — shutting down workers...");
    for (const id in cluster.workers) {
      cluster.workers[id].kill("SIGTERM");
    }
    setTimeout(() => process.exit(0), 5000);
  });
} else {
  // Worker — run the actual server
  require("./index");
}
