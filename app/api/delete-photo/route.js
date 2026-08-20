import { del } from "@vercel/blob";

export async function POST(request) {
  try {
    const { url } = await request.json();
    if (!url) {
      return Response.json({ error: "url manquante" }, { status: 400 });
    }
    await del(url);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}