// Usage: pnpm user:create <email> <name> <password>
// Creates the user, or resets the password if the email already exists.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db, t } from "../src/db";

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error("Usage: pnpm user:create <email> <name> <password>");
  process.exit(1);
}

const passwordHash = await bcrypt.hash(password, 12);
await db
  .insert(t.users)
  .values({ email: email.toLowerCase(), name, passwordHash })
  .onConflictDoUpdate({ target: t.users.email, set: { name, passwordHash } });
console.log(`User ready: ${email}`);
process.exit(0);
