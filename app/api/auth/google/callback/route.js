// Reçoit le code de retour de Google, l'échange contre des jetons d'accès,
// puis renvoie une petite page qui enregistre ces jetons dans le navigateur
// de la personne (localStorage) avant de revenir à l'application.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return htmlRedirect(`Connexion annulée ou refusée (${error}).`);
  }
  if (!code) {
    return htmlRedirect("Code de connexion manquant.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${url.origin}/api/auth/google/callback`;

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();

    if (!tokenRes.ok) {
      return htmlRedirect(`Erreur Google : ${tokens.error_description || tokens.error || "inconnue"}`);
    }

    // tokens contient: access_token, refresh_token (si premier consentement), expires_in
    const payload = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
    };

    return new Response(
      `<!DOCTYPE html><html><body style="background:#070a0f;color:#e8f1f5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <p>Connexion réussie, retour à JARVIS...</p>
        <script>
          try {
            var existing = localStorage.getItem('jarvis:google-tokens');
            var payload = ${JSON.stringify(payload)};
            // Si pas de nouveau refresh_token (reconnexion), on garde l'ancien
            if (!payload.refresh_token && existing) {
              var old = JSON.parse(existing);
              payload.refresh_token = old.refresh_token;
            }
            localStorage.setItem('jarvis:google-tokens', JSON.stringify(payload));
          } catch(e) {}
          window.location.replace('/');
        </script>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  } catch (err) {
    return htmlRedirect("Erreur de connexion à Google. Réessaie.");
  }
}

function htmlRedirect(message) {
  return new Response(
    `<!DOCTYPE html><html><body style="background:#070a0f;color:#e8f1f5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px;">
      <div><p>${message}</p><a href="/" style="color:#3dd6d0;">Retour à JARVIS</a></div>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}