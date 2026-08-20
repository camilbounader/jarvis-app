import { put } from "@vercel/blob";

export async function POST(request) {
  try {
    const { dataUrl } = await request.json();
    if (!dataUrl) {
      return Response.json({ error: "dataUrl manquant" }, { status: 400 });
    }

    const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
      return Response.json({ error: "Format image invalide" }, { status: 400 });
    }
    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");
    const ext = mimeType.split("/")[1] || "jpg";
    const filename = `jarvis-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const blob = await put(filename, buffer, { access: "public", contentType: mimeType });

    return Response.json({ url: blob.url });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}