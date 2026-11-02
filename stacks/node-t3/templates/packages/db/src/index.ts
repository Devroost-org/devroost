import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { todos } from "./schema";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://devroost:devroost@db:5432/t3";
const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

export async function ensureSchema(): Promise<void> {
  await client`
    create table if not exists todos (
      id serial primary key,
      title text not null,
      done boolean not null default false,
      created_at integer not null
    )
  `;
}

export async function getTodos() {
  return db.select().from(todos);
}

export async function seedTodos(): Promise<void> {
  await ensureSchema();

  const existing = await db.select().from(todos).where(eq(todos.title, "Wire Turborepo"));
  if (existing.length > 0) {
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  await db.insert(todos).values([
    { title: "Wire Turborepo", done: true, createdAt: now },
    { title: "Style with Tailwind", done: true, createdAt: now },
    { title: "Persist with Drizzle", done: false, createdAt: now }
  ]);
}
