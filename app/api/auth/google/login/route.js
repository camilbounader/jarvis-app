// Démarre la connexion Google : redirige la personne vers l'écran de
// consentement Google (calendrier en lecture/écriture).
export async function GET(request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/google/callback`;

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", clientId);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set(
    "scope",
    "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.profile"
  );
  googleAuthUrl.searchParams.set("access_type", "offline"); // pour obtenir un refresh_token
  googleAuthUrl.searchParams.set("prompt", "consent"); // force le refresh_token à chaque connexion

  return Response.redirect(googleAuthUrl.toString(), 302);
}
