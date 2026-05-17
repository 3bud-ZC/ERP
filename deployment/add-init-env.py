import secrets
from pathlib import Path
path = Path('/var/www/erp/.env')
if not path.exists():
    raise SystemExit('.env not found')
with path.open('a', encoding='utf-8') as f:
    f.write('\nSETUP_TOKEN=' + secrets.token_urlsafe(32) + '\n')
    f.write('ADMIN_PASSWORD=' + secrets.token_urlsafe(24) + '\n')
    f.write('TEST_PASSWORD=' + secrets.token_urlsafe(24) + '\n')
print('ok')
