# Per-workstream test and capture databases in a local Postgres container.
# Usage: ./test-db.ps1 create|drop|capture|drop-capture <workstream>
# Settings (env, with defaults): PG_CONTAINER=orchestra-postgres PG_USER=app
#   PG_PASSWORD=app PG_PORT=5432 DEV_DB=app MIGRATE_CMD= (run after create/capture
#   with DATABASE_URL and TEST_DATABASE_URL set to the new database)
param(
    [Parameter(Mandatory)][ValidateSet('create', 'drop', 'capture', 'drop-capture')][string]$Action,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9_]+$')][string]$Workstream
)
$ErrorActionPreference = 'Stop'

function Get-Setting($name, $default) { $v = [Environment]::GetEnvironmentVariable($name); if ($v) { $v } else { $default } }
$container = Get-Setting 'PG_CONTAINER' 'orchestra-postgres'
$user = Get-Setting 'PG_USER' 'app'
$password = Get-Setting 'PG_PASSWORD' 'app'
$port = Get-Setting 'PG_PORT' '5432'
$devDb = Get-Setting 'DEV_DB' 'app'
if ($devDb -notmatch '^[A-Za-z0-9_]+$') { throw 'DEV_DB must match [A-Za-z0-9_]+' }

# Names always carry a _test_ or _capture_ suffix, so no action here can touch the dev database.
$testDb = "${devDb}_test_$Workstream"
$captureDb = "${devDb}_capture_$Workstream"

function Invoke-Admin($sql) {
    $out = docker exec -i $container psql -v ON_ERROR_STOP=1 -U $user -d postgres -qtAc $sql
    if ($LASTEXITCODE -ne 0) { throw "psql failed: $sql" }
    $out
}
function Test-Db($name) { (Invoke-Admin "SELECT 1 FROM pg_database WHERE datname = '$name'") -eq '1' }
function Get-Url($name) { "postgresql://${user}:${password}@localhost:${port}/$name" }
function Invoke-Migrate($name) {
    $cmd = Get-Setting 'MIGRATE_CMD' ''
    if (-not $cmd) { return }
    $env:DATABASE_URL = Get-Url $name; $env:TEST_DATABASE_URL = Get-Url $name
    Invoke-Expression $cmd
    if ($LASTEXITCODE -ne 0) { throw "MIGRATE_CMD failed" }
}

switch ($Action) {
    'create' {
        if (Test-Db $testDb) { "exists: $testDb" } else { Invoke-Admin "CREATE DATABASE `"$testDb`"" | Out-Null; "created: $testDb" }
        Invoke-Migrate $testDb
        "TEST_DATABASE_URL=$(Get-Url $testDb)"
    }
    'drop' {
        Invoke-Admin "DROP DATABASE IF EXISTS `"$testDb`" WITH (FORCE)" | Out-Null
        "dropped: $testDb"
    }
    'capture' {
        # A fresh copy of the local dev database for screenshots. Never a production database.
        if (-not (Test-Db $devDb)) { throw "dev database '$devDb' not found in container '$container'" }
        Invoke-Admin "DROP DATABASE IF EXISTS `"$captureDb`" WITH (FORCE)" | Out-Null
        Invoke-Admin "CREATE DATABASE `"$captureDb`"" | Out-Null
        docker exec $container sh -c "pg_dump -U '$user' '$devDb' | psql -q -v ON_ERROR_STOP=1 -U '$user' -d '$captureDb'" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'capture copy failed' }
        "captured: $devDb -> $captureDb"
        "DATABASE_URL=$(Get-Url $captureDb)"
    }
    'drop-capture' {
        Invoke-Admin "DROP DATABASE IF EXISTS `"$captureDb`" WITH (FORCE)" | Out-Null
        "dropped: $captureDb"
    }
}
