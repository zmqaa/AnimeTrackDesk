module.exports = {
  apps: [{
    name: 'anime-track',
    cwd: '/home/ubuntu/zmqaa/anime',
    script: 'scripts/deploy/prod_start_guard.js',
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: '3000',
      HOST: '127.0.0.1'
    },
    node_args: '--max-old-space-size=256',
    instances: 1,
    autorestart: true,
    max_restarts: 15,
    min_uptime: '5s',
    restart_delay: 3000,
    max_memory_restart: '300M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
