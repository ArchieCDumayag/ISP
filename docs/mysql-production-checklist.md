# MySQL Production Checklist

- Create a dedicated MySQL user (no root) with least-privilege access to the app database.
- Disable or restrict remote root login; keep root local-only.
- Open port 3306 only to trusted app servers (firewall/security group).
- Turn on automated backups (daily) and verify restores monthly.
- Monitor disk usage (DB, binary logs, backups).
- Enable slow query log and review hotspots.
- Use strong passwords and rotate periodically.
- Keep MySQL updated (security patches).
