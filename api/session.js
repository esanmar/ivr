module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
    const REALTIME_MODEL = process.env.REALTIME_MODEL || "gpt-4o-realtime-preview";
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Falta OPENAI_API_KEY en el servidor" });

    const { voice = "coral", instructions = "" } = req.body || {};
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify({
        model: REALTIME_MODEL,
        voice,
        modalities: ["audio","text"],
        instructions,
        tools: [{
          type: "function",
          name: "certificado_lookup",
          description: "Obtiene un certificado tributario por NIF/DNI",
          parameters: {
            type: "object",
            properties: {
              nif: { type: "string" },
              comprobar: { type: "boolean", default: true },
              usuario: { type: "string", default: "Internet" }
            },
            required: ["nif"]
          }
        }]
      })
    });

    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};