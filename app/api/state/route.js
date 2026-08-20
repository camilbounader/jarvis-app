import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

async function ensureTable() {
  await sql`CREATE TABLE IF NOT EXISTS jarvis_state (
    id text PRIMARY KEY,
    data text,
    updated_at timestamptz DEFAULT now()
  )`;
}

export async function GET() {
  try {
    await ensureTable();
    const rows = await sql`SELECT data FROM jarvis_state WHERE id = 'household'`;
    if (rows.length === 0) {
      return Response.json({ value: null });
    }
    return Response.json({ value: rows[0].data });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { value } = await request.json();
    await ensureTable();
    await sql`
      INSERT INTO jarvis_state (id, data, updated_at)
      VALUES ('household', ${value}, now())
      ON CONFLICT (id) DO UPDATE SET data = ${value}, updated_at = now()
    `;
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}