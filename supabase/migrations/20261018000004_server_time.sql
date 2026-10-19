-- Scripts take "now" from the database, not from the machine running them, so a wrong PC clock
-- cannot make seeded dates disagree with the dashboard views (which use the database clock).
create or replace function server_time() returns timestamptz
language sql stable as $$ select now() $$;

revoke execute on function server_time() from public, anon;
grant execute on function server_time() to authenticated, service_role;
