/* global __dirname, module, process */

const port = process.env.KIOSK_PORT?.trim() || "3099";

if (!/^\d+$/.test(port)) {
  throw new Error("KIOSK_PORT must be a numeric TCP port.");
}

module.exports = {
  apps: [
    {
      name: "css-kiosk",
      cwd: __dirname,
      script: "./node_modules/next/dist/bin/next",
      args: ["start", "--hostname", "127.0.0.1", "--port", port],
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      exp_backoff_restart_delay: 100,
      time: true,
      env: {
        NODE_ENV: "production",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
