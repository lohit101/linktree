import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const template = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const content = template
  .replace("GENERATE_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS", randomBytes(48).toString("hex"));
try {
  await writeFile(new URL("../.env.local", import.meta.url), content, { flag: "wx", mode: 0o600 });
  console.log("Created .env.local with fresh secrets and fictional demo contacts.\nRun npm run dev, then open http://127.0.0.1:3000.\nBrowser checks run locally and in production without any verification provider or database.");
} catch (error) {
  if (error.code === "EEXIST") console.log(".env.local already exists; preserved your configuration.");
  else throw error;
}
