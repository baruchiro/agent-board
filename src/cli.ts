/**
 * Host provisioning. Each machine or cloud environment gets its own token;
 * the token is printed once and only its hash is stored.
 *
 *   bun run src/cli.ts add <name> <local|desktop|remote|cloud> [--retain-raw]
 *   bun run src/cli.ts list
 */
import { createHost, db, hostByName, HOST_KINDS, type HostKind } from "./db";

const [, , cmd, ...rest] = process.argv;

if (cmd === "add") {
  const [name, kind] = rest;
  if (!name || !kind || !HOST_KINDS.includes(kind as HostKind)) {
    console.error(`usage: add <name> <${HOST_KINDS.join("|")}> [--retain-raw]`);
    process.exit(1);
  }
  if (hostByName(name)) {
    console.error(`host "${name}" already exists`);
    process.exit(1);
  }
  const { token } = createHost(name, kind as HostKind, rest.includes("--retain-raw"));
  console.log(`host "${name}" (${kind}) created.\n`);
  console.log(`  AGENT_BOARD_TOKEN=${token}\n`);
  console.log("Set that in the host's environment. It is not stored and cannot be shown again.");
} else if (cmd === "list") {
  const hosts = db
    .query("SELECT name, kind, retain_raw, last_seen_at FROM host ORDER BY name")
    .all() as Array<{ name: string; kind: string; retain_raw: number; last_seen_at: number | null }>;
  if (hosts.length === 0) console.log("no hosts yet");
  for (const h of hosts) {
    const seen = h.last_seen_at ? new Date(h.last_seen_at).toISOString() : "never";
    console.log(`${h.name.padEnd(24)} ${h.kind.padEnd(8)} raw=${h.retain_raw}  last seen ${seen}`);
  }
} else {
  console.error("usage: add | list");
  process.exit(1);
}
