// Apply all SQL migrations in supabase/migrations/ to a Postgres database.
// Probes Supabase pooler regions if the supplied URL fails.

import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  'ap-south-1', 'sa-east-1', 'ca-central-1',
];

interface ConnInfo { host: string; user: string; password: string; ref: string; region?: string }

async function tryConnect(info: ConnInfo): Promise<Client | null> {
  const c = new Client({
    host: info.host,
    port: 5432,
    user: info.user,
    password: info.password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    statement_timeout: 30_000,
    query_timeout: 30_000,
    connectionTimeoutMillis: 8_000,
  });
  try {
    await c.connect();
    return c;
  } catch (e) {
    if (process.env.MIGRATE_VERBOSE) console.log('   ', (e as Error).message);
    await c.end().catch(() => {});
    return null;
  }
}

function parseDbUrl(url: string): ConnInfo | null {
  // Pooler URL pattern: postgres://postgres.{ref}:{pwd}@aws-0-{region}.pooler.supabase.com:5432/postgres
  const m = url.match(/postgres(?:ql)?:\/\/postgres\.([\w-]+):([^@]+)@aws-0-([\w-]+)\.pooler\.supabase\.com/);
  if (!m) return null;
  const ref = m[1]!;
  const pwd = decodeURIComponent(m[2]!);
  const region = m[3]!;
  return {
    host: `aws-0-${region}.pooler.supabase.com`,
    user: `postgres.${ref}`,
    password: pwd,
    ref,
    region,
  };
}

async function main() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const password = process.env.SUPABASE_DB_PASSWORD;
  const initialUrl = process.env.SUPABASE_DB_URL ?? process.argv[2];

  let info: ConnInfo | null = null;
  if (ref && password) {
    info = { host: 'aws-0-us-east-1.pooler.supabase.com', user: `postgres.${ref}`, password, ref, region: 'us-east-1' };
  } else if (initialUrl) {
    info = parseDbUrl(initialUrl);
    if (!info) {
      console.error('Could not parse SUPABASE_DB_URL');
      process.exit(1);
    }
  } else {
    console.error('Set SUPABASE_PROJECT_REF + SUPABASE_DB_PASSWORD, or SUPABASE_DB_URL');
    process.exit(1);
  }

  let client = await tryConnect(info);

  if (!client) {
    console.log(`Sweeping pooler regions for project ${info.ref}…`);
    for (const r of REGIONS) {
      process.stdout.write(`  ${r} `);
      const candidate: ConnInfo = { ...info, host: `aws-0-${r}.pooler.supabase.com`, region: r };
      client = await tryConnect(candidate);
      if (client) {
        console.log('✓ connected');
        info = candidate;
        break;
      }
      console.log('✗');
    }
  }

  if (!client) {
    console.error('Could not connect to any Supabase pooler region. Check the password / project status.');
    process.exit(1);
  }

  console.log(`Connected via ${info.host} as ${info.user}`);

  const dir = path.resolve('supabase/migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  console.log(`Applying ${files.length} migrations from ${dir}`);

  for (const f of files) {
    const p = path.join(dir, f);
    const sql = fs.readFileSync(p, 'utf8');
    process.stdout.write(`  ${f} `);
    try {
      await client.query(sql);
      console.log('✓');
    } catch (e) {
      console.log('✗');
      console.error((e as Error).message);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log('All migrations applied.');
  const detected = `postgresql://${info.user}:${encodeURIComponent(info.password)}@${info.host}:5432/postgres`;
  console.log(`\nDetected pooler URL — paste this into your env files:\n${detected}`);
}

main().catch(e => { console.error(e); process.exit(1); });
