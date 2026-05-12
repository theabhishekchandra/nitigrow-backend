/**
 * PM2 process declaration for NitiGrow backend.
 *
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 reload all                                   # zero-downtime reload after `git pull && npm ci`
 *   pm2 save && pm2 startup                          # persist + boot on reboot (run once on the VPS)
 *
 * Two processes:
 *   - nitigrow-api    — Express + Socket.io, in cluster mode (one per vCPU)
 *   - nitigrow-worker — BullMQ workers, fork mode (single process is fine)
 */
module.exports = {
  apps: [
    {
      name: 'nitigrow-api',
      script: './src/index.js',
      exec_mode: 'cluster',
      instances: 'max',                // one worker per vCPU
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
        RUN_WORKER: 'false',
      },
      env_staging: {
        NODE_ENV: 'production',        // staging runs the prod build; differ via .env
        RUN_WORKER: 'false',
      },
      kill_timeout: 8000,              // give graceful shutdown time to drain
      wait_ready: false,
      listen_timeout: 10000,
    },
    {
      name: 'nitigrow-worker',
      script: './src/worker.js',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '768M',
      env_production: {
        NODE_ENV: 'production',
        RUN_WORKER: 'true',
      },
      env_staging: {
        NODE_ENV: 'production',
        RUN_WORKER: 'true',
      },
      kill_timeout: 8000,
    },
  ],
};
