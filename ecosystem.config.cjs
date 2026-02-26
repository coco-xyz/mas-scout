module.exports = {
  apps: [
    {
      name: 'mas-scout-watcher',
      script: 'src/watcher/index.js',
      cron_restart: '0 1 * * *',  // 09:00 SGT = 01:00 UTC daily
      autorestart: false,          // cron-driven, not a daemon
      watch: false,
      max_memory_restart: '256M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'data/logs/watcher-error.log',
      out_file: 'data/logs/watcher-out.log',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
