#!/usr/bin/env sh
export PGPASSWORD='4lmgN_8kvGttWPHMp-P2AzJEALWJnUPgaZ3ScrYx8X0'
psql -U erp_prod_user -d erp_system_prod -h 127.0.0.1 -t <<'SQL'
SELECT reltuples::bigint AS approx_users FROM pg_class WHERE relname = 'User';
SELECT reltuples::bigint AS approx_roles FROM pg_class WHERE relname = 'Role';
SELECT reltuples::bigint AS approx_tenants FROM pg_class WHERE relname = 'Tenant';
SELECT reltuples::bigint AS approx_user_tenant_roles FROM pg_class WHERE relname = 'UserTenantRole';
SELECT reltuples::bigint AS approx_role_permissions FROM pg_class WHERE relname = 'RolePermission';
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'SystemSettings';
SQL
