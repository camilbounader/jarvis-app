// Cette route reçoit les requêtes JARVIS au même format que celui utilisé
// dans le prototype (façon API Claude : { system, messages }), mais appelle
// Gemini côté serveur avec la clé secrète (jamais exposée au navigateur), et
// renvoie une réponse dans le même format que Claude ({ content: [...] })
// pour que le code existant du frontend n'ait besoin d'aucun autre changement.

export async function POST(request) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return Response.json(
      { content: [{ type: "text", text: JSON.stringify({ reply: "Erreur : clé Gemini manquante côté serveur (.env.local ou Vercel).", actions: [] }) }] },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ content: [{ type: "text", text: "{}" }] }, { status: 400 });
  }

  const { system, messages } = body;

  // Convertit le format "façon Claude" (content: string OU tableau de blocs)
  // vers le format attendu par Gemini (parts).
  function toParts(content) {
    if (typeof content === "string") return [{ text: content }];
    if (!Array.isArray(content)) return [{ text: "" }];
    return content.map((block) => {
      if (block.type === "image") {
        return {
          inline_data: {
            mime_type: block.source?.media_type || "image/jpeg",
            data: block.source?.data || "",
          },
        };
      }
      return { text: block.text || "" };
    });
  }

  const contents = (messages || []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: toParts(m.content),
  }));

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
          contents,
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      const errMsg = data?.error?.message || "Erreur inconnue de l'API Gemini.";
      return Response.json(
        { content: [{ type: "text", text: JSON.stringify({ reply: `Erreur API Gemini : ${errMsg}`, actions: [] }) }] },
        { status: 200 }
      );
    }

    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";

    return Response.json({ content: [{ type: "text", text }] });
  } catch (err) {
    return Response.json(
      { content: [{ type: "text", text: JSON.stringify({ reply: "Erreur de connexion à Gemini. Réessaie dans un instant.", actions: [] }) }] },
      { status: 200 }
    );
  }
}
