const { TextToSpeechClient } = require("@google-cloud/text-to-speech");

function mkClient() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    const creds = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    return new TextToSpeechClient({ credentials: creds });
  }
  // Fallback to ADC (works locally if GOOGLE_APPLICATION_CREDENTIALS points to a file)
  return new TextToSpeechClient();
}

const ttsClient = mkClient();

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { text, lang = "eu-ES", voice = "eu-ES-Standard-B", speed = 1.0, pitch = 0.0 } = req.body || {};
    if (!text) return res.status(400).json({ error: "Falta text" });

    const [resp] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { languageCode: lang, name: voice },
      audioConfig: { audioEncoding: "MP3", speakingRate: Number(speed) || 1.0, pitch: Number(pitch) || 0.0 },
    });

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(resp.audioContent, "base64"));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
