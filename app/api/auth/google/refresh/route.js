// Renouvelle un access_token expiré à partir du refresh_token, en utilisant
// le Client Secret côté serveur uniquement (jamais exposé au navigateur).
export async function POST(request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "Requête invalide" }, { status: 400 });
  }

  const { refresh_token } = body;
  if (!refresh_token) {
    return Response.json({ error: "refresh_token manquant" }, { status: 400 });
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      return Response.json({ error: data.error_description || data.error || "Erreur inconnue" }, { status: 400 });
    }

    return Response.json({
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    });
  } catch (err) {
    return Response.json({ error: "Erreur de connexion à Google" }, { status: 500 });
  }
}
