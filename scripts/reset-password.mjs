// Gives your account a new password, for when you've forgotten it: the app
// sends no email, so there's no reset link. Prints the new password, and
// signs you out everywhere.
//
//   docker compose run --rm reset-password      (the Docker copy)
//   pnpm reset-password                         (with DATABASE_URL in .env)
import { randomBytes } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import pg from "pg";

// Outside Docker, read DATABASE_URL from .env. Variables already set win.
try {
  process.loadEnvFile();
} catch {
  // No .env: in Docker the variables come from compose.
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (in .env or the environment) and run again.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(
    'select id, email from "user" order by created_at limit 1',
  );
  const owner = rows[0];
  if (!owner) {
    console.error(
      "There's no account yet. Open the app and create it with the setup code.",
    );
    process.exitCode = 1;
  } else {
    const password = randomBytes(15).toString("base64url");
    const hash = await hashPassword(password);
    await client.query("begin");
    const updated = await client.query(
      `update account set password = $1, updated_at = now()
       where user_id = $2 and provider_id = 'credential'`,
      [hash, owner.id],
    );
    if (updated.rowCount !== 1) {
      await client.query("rollback");
      console.error("The account has no password sign-in to reset.");
      process.exitCode = 1;
    } else {
      await client.query("delete from session where user_id = $1", [owner.id]);
      await client.query("commit");
      console.log(
        [
          "",
          `New password for ${owner.email}:`,
          "",
          `  ${password}`,
          "",
          "Save it in your password manager, then sign in. Every device was signed out.",
        ].join("\n"),
      );
    }
  }
} finally {
  await client.end();
}
