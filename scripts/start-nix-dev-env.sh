#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
script_path="$script_dir/$(basename -- "${BASH_SOURCE[0]}")"

if [[ "${1:-}" != "--inside-nix-shell" ]]; then
    exec nix develop "$project_root" --command bash "$script_path" --inside-nix-shell "$@"
fi

shift

cd "$project_root"

data_dir="$project_root/.data/postgres"
log_file="$project_root/.data/postgres.log"
database_host="127.0.0.1"
database_port="5432"
database_user="polynux"
database_name="polynux"
local_socket="$data_dir"

mkdir -p "$project_root/.data"

if ! pg_isready -h "$database_host" -p "$database_port" >/dev/null 2>&1; then
    if [[ ! -f "$data_dir/PG_VERSION" ]]; then
        echo "Initializing local PostgreSQL database..."
        initdb -D "$data_dir" -U "$database_user" -A trust --no-locale >/dev/null
    fi

    echo "Starting local PostgreSQL server..."
    pg_ctl -D "$data_dir" -l "$log_file" -o "-p $database_port -k $data_dir" start >/dev/null
fi

for _ in {1..30}; do
    if pg_isready -h "$database_host" -p "$database_port" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

if ! pg_isready -h "$database_host" -p "$database_port" >/dev/null 2>&1; then
    echo "PostgreSQL did not become ready. See $log_file" >&2
    exit 1
fi

export DATABASE_URL="postgresql://$database_user@$database_host:$database_port/$database_name"
export PGPASSWORD="polynux"

if ! psql -h "$local_socket" -p "$database_port" -U "$database_user" -d postgres \
    -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$database_user'" | grep -q 1; then
    createuser -h "$local_socket" -p "$database_port" -U "$database_user" --createdb --login "$database_user"
fi

psql -h "$local_socket" -p "$database_port" -U "$database_user" -d postgres \
    -c "ALTER ROLE \"$database_user\" WITH PASSWORD 'polynux'" >/dev/null

if ! psql -h "$local_socket" -p "$database_port" -U "$database_user" -d postgres \
    -tAc "SELECT 1 FROM pg_database WHERE datname = '$database_name'" | grep -q 1; then
    echo "Creating database $database_name..."
    createdb -h "$local_socket" -p "$database_port" -U "$database_user" "$database_name"
fi

echo "Applying database schema..."
bun run db:push

user_count="$(psql "$DATABASE_URL" -tAc 'SELECT count(*) FROM "user"')"
if [[ "$user_count" == "0" ]]; then
    echo "Database is empty; seeding development data..."
    bun run db:seed
else
    echo "Database already contains $user_count user(s); skipping seed."
fi

exec bun --bun nuxt dev --host 127.0.0.1
