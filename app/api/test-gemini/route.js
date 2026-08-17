
export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return Response.json(
      { ok: false, error: "GEMINI_API_KEY non trouvée dans .env.local" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { parts: [{ text: "Réponds juste avec le mot: OK" }] },
          ],
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return Response.json({ ok: false, error: data }, { status: res.status });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "(pas de réponse)";
    return Response.json({ ok: true, reply });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
