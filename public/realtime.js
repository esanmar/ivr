// public/realtime.js
const $$ = (id) => document.getElementById(id);
const transcriptEl = $$("transcript");
const rtcStatus = $$("rtcStatus");

let pc;
let dc;
let pdfWin = null;
let dcMessageCount = 0;

// Mic & audio control
let micTracks = [];
function setMicEnabled(on) { micTracks.forEach(t => t.enabled = on); }

// Reconocimiento local (solo NIF)
let recog;
let recogActive = false;
let lastNif = null;

// Control de flujo PDF
let pdfTriggered = false;

// ===== Saludos y prompt seguro =====
const GREETING_ES =
  "Hola, este es el servicio de la Diputación Foral de Álava para obtener tu certificado, ¿me facilitas tu DNI?";
const GREETING_EU =
  "Kaixo, hau da Arabako Foru Aldundiaren zerbitzua zure ziurtagiria lortzeko. Emango didazu zure NANa?";

const SAFE_PROMPT_ES = `
Eres un agente de voz estrictamente limitado a un único servicio: obtener el certificado tributario en PDF a partir de un NIF/DNI.
Prohibido responder a cualquier otra pregunta o tema.
Habla SIEMPRE en español de España (es-ES, acento castellano).

Flujo permitido:
1) Saluda una sola vez: "Hola, este es el servicio de la Diputación Foral de Álava para obtener tu certificado, ¿me facilitas tu DNI?"
2) Escucha el NIF/DNI. Si no encaja con 7–8 dígitos + letra (p.ej., 55000016R), pide repetirlo claro y todo junto.
3) Con NIF válido, no pidas nombre. No valides ni calcules el DNI: la validación la hace el cliente.
4) Cuando el cliente te envíe texto explícito, di exactamente: "Abriendo el PDF."
5) Si no hay PDF o hay error (el cliente te lo indicará), di una frase breve y vuelve a pedir el NIF: "No he podido obtener el PDF. ¿Me repites el DNI, por favor?"

Límites y seguridad:
- No respondas a nada que no sea proporcionar el certificado por NIF (rechaza con: "Lo siento, sólo puedo ayudarte a obtener el certificado en PDF por DNI.").
- No solicites datos adicionales ni leas datos sensibles.
- Idioma: español (es-ES, acento de España).
`.trim();

const SAFE_PROMPT_EU = `
Ahots-agente bat zara eta zerbitzu bakarra eskaintzen duzu: PDF ziurtagiria lortzea NAN zenbakiaren bidez.
Debekatuta beste ezer erantzutea.
Hitz egin beti euskaraz (euskara batua).

Onartutako jarduera:
1) Agurtu behin: "Kaixo, hau da Arabako Foru Aldundiaren zerbitzua zure ziurtagiria lortzeko. Emango didazu zure NANa?"
2) Entzun NANa. 7–8 zenbaki + letra ez bada, eskatu berriro argi eta elkarren ondoan.
3) NANa emanda, ez balioztatu: bezeroak egingo du egiaztapena.
4) Bezeroak testu esplizitua bidaltzen duenean, esan zehazki: "PDFa irekitzen ari naiz."
5) Errorea/PDFrik ez badago (bezeroak adieraziko du), esaldi laburra eta NANa berriro eskatu: "Ezin izan dut PDFa eskuratu. Mesedez, errepikatu NANa."

Mugak:
- Off-topic: "Barkatu, NAN bidezko PDF ziurtagiria bakarrik lagun zaitzaket."
- Ez datu gehigarririk, ezta informazio sentikorrik ahoz.
- Hizkuntza: euskara.
`.trim();

// ===== Helpers NIF =====
function dniExpectedLetter(num8) {
  const letras = "TRWAGMYFPDXBNJZSQVHLCKE";
  const n = parseInt(num8, 10);
  if (!Number.isFinite(n)) return null;
  return letras[n % 23];
}

// Convierte números hablados ES → dígitos (básico; fallback si ASR devuelve palabras)
function normalizeSpanishNumbers(s) {
  let t = ` ${s.toLowerCase()} `;
  const map = {
    " cero ": " 0 ",
    " uno ": " 1 ", " una ": " 1 ",
    " dos ": " 2 ",
    " tres ": " 3 ",
    " cuatro ": " 4 ",
    " cinco ": " 5 ",
    " seis ": " 6 ",
    " siete ": " 7 ",
    " ocho ": " 8 ",
    " nueve ": " 9 ",
  };
  Object.keys(map).forEach(k => { t = t.replaceAll(k, map[k]); });
  t = t.replace(/\s+y\s+/g, " ");
  return t.toUpperCase();
}

// Acepta “55000016R” y “55000016 R”; devuelve el ÚLTIMO válido del contexto
function extractBestNif(text) {
  const drop = text
    .replace(/hola,?\s+este.*?dni\??/i, " ")
    .replace(/kaixo.*?nana\??/i, " ");
  const norm = normalizeSpanishNumbers(drop)
    .normalize("NFKD").toUpperCase()
    .replace(/[^0-9A-Z]/g, " ");
  const re = /(\d{8})\s*([A-Z])/g;
  const matches = [...norm.matchAll(re)];
  if (!matches.length) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const num = matches[i][1];
    const letter = matches[i][2];
    if (dniExpectedLetter(num) === letter) return `${num}${letter}`;
  }
  return null;
}

// ===== Utilidades UI =====
function logUI(msg, obj) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[realtime ${t}] ${msg}`, obj ?? "");
  if (transcriptEl) transcriptEl.textContent += `[cliente] ${msg}\n`;
}
function setRtcStatus(msg, ok = true) {
  if (!rtcStatus) return;
  rtcStatus.className = ok ? "ok" : "err";
  rtcStatus.textContent = msg;
}
function appendTranscript(text) { if (transcriptEl) transcriptEl.textContent += text; }

// ===== Reconocimiento de voz (solo NIF) =====
function stopLocalRecognition() {
  try { if (recog && recogActive) recog.stop(); } catch {}
  recogActive = false;
}
function switchRecognitionLang(newLangCode, uiSelectId = "lang") {
  stopLocalRecognition();
  try {
    const sel = document.getElementById(uiSelectId);
    if (sel) sel.value = (newLangCode === "eu-ES" ? "eu" : "es");
  } catch {}
  startLocalRecognition(newLangCode.startsWith("eu") ? "eu" : "es");
}
function startLocalRecognition(lang) {
  if (recogActive) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { logUI("Web Speech API no disponible; sin fallback NIF."); return; }
  recogActive = true;
  recog = new SR();
  recog.lang = (lang === "eu") ? "eu-ES" : "es-ES";
  recog.interimResults = true;
  recog.continuous = true;

  recog.onresult = (ev) => {
    const txt = Array.from(ev.results).map(r => r[0].transcript).join(" ");
    appendTranscript(`\n[voz] ${txt}\n`);
    logUI(`[ASR] len=${txt.length} muestra="${txt.slice(-80)}"`);

    if (recog.lang === "es-ES") {
      const probe = txt.toLowerCase().normalize("NFKD");
      if (/\b(kaixo|zer|moduz|mesedez|eskerrik asko|agur)\b/.test(probe)) {
        logUI("Detectado euskera → cambio a eu-ES");
        switchRecognitionLang("eu-ES");
        return;
      }
    }

    const fullCtx = (transcriptEl?.textContent || "") + " " + txt;
    const best = extractBestNif(fullCtx);
    if (best && best !== lastNif) {
      lastNif = best;
      logUI(`Detectado NIF válido: ${lastNif}`);
      triggerPdfFlow();
    } else if (!best) {
      const norm = normalizeSpanishNumbers(fullCtx).normalize("NFKD").replace(/[^0-9A-Z]/g, " ");
      const cand = norm.match(/\b\d{8}\s*[A-Z]\b/g);
      logUI(`[ASR] candidatos=${JSON.stringify(cand)}`);
    }
  };

  recog.onerror = (e) => logUI("Reconocimiento de voz (local) error: " + e.error);
  recog.onend = () => {
    logUI("Reconocimiento de voz (local) finalizado");
    recogActive = false;
    if (!pdfTriggered) {
      const fullCtx = (transcriptEl?.textContent || "");
      const best = extractBestNif(fullCtx);
      if (best && best !== lastNif) {
        lastNif = best;
        logUI(`[fallback onend] NIF válido: ${lastNif}`);
        triggerPdfFlow();
      } else {
        logUI("[fallback onend] No se detectó NIF válido.");
      }
    }
  };

  recog.start();
  logUI("Reconocimiento de voz (local) iniciado (" + recog.lang + ")");
}

// ===== PDF (abre SIEMPRE en pestaña nueva ya pre-abierta) =====
async function tryOpenPdfWithLastArgs() {
  if (!lastNif) { logUI("No tengo NIF local para pedir el PDF."); return; }
  const directUrl = `/api/certificado/pdf?nif=${encodeURIComponent(lastNif)}&comprobar=true&usuario=Internet`;
  try {
    if (pdfWin && !pdfWin.closed) {
      pdfWin.location.href = directUrl;
      logUI("PDF abierto en ventana pre-abierta.");
      return;
    }
    const w = window.open(directUrl, "_blank", "noopener,noreferrer");
    if (!w) { logUI("Popup bloqueado: el navegador impide abrir nueva pestaña sin interacción directa."); alert("Permite pop-ups para ver el PDF."); return; }
    pdfWin = w;
    logUI("PDF abierto en nueva pestaña creada en el momento.");
  } catch (e) {
    logUI("Error abriendo PDF directo: " + e.message);
  }
}
async function waitForArgsThenOpenPdf(timeoutMs = 4500) {
  const t0 = Date.now();
  while (!lastNif && Date.now() - t0 < timeoutMs) await new Promise(r => setTimeout(r, 150));
  if (!lastNif) {
    const snapshot = (transcriptEl?.textContent || "").slice(-160);
    logUI(`Timeout esperando NIF (8 dígitos + letra). Ultimo texto="${snapshot}"`);
    return;
  }
  await tryOpenPdfWithLastArgs();
}

// ===== Disparo de flujo PDF -> habla, abre y corta audio/sesión =====
async function triggerPdfFlow() {
  if (pdfTriggered) return;
  pdfTriggered = true;

  // 1) Indicar al agente que anuncie (sin validar DNI) y luego silencio
  const uiLang = document.getElementById("lang")?.value || "es";
  const say = (uiLang === "eu") ? "PDFa irekitzen ari naiz." : "Abriendo el PDF.";
  if (dc && dc.readyState === "open") {
    dc.send(JSON.stringify({ type: "input_text.create", text: say }));
    dc.send(JSON.stringify({
      type: "response.create",
      response: { modalities:["audio","text"], tool_choice:"none", conversation:"none" }
    }));
    dc.send(JSON.stringify({
      type: "response.create",
      response: { instructions: "Permanece en silencio. No evalúes el DNI ni respondas más.", modalities:["text"], tool_choice:"none" }
    }));
  }

  // 2) Abrir el PDF en pestaña nueva (pre-abierta)
  tryOpenPdfWithLastArgs();

  // 3) Cortar reconocimiento local y dejar de enviar audio al agente
  try { if (recog) recog.stop(); } catch {}
  recogActive = false;
  setMicEnabled(false);
  try { micTracks.forEach(t => t.stop()); } catch {}
  try { if (pc) { pc.getSenders()?.forEach(s => { try { s.replaceTrack(null); } catch {} }); } } catch {}

  // 4) Cerrar sesión WebRTC tras pronunciar el aviso
  setTimeout(() => { try { if (pc) pc.close(); } catch {} }, 1200);
}

// ===== Saludo =====
function sendAssistantGreeting(channel, uiLang) {
  const text = (uiLang === "eu") ? GREETING_EU : GREETING_ES;
  channel.send(JSON.stringify({ type: "input_text.create", text }));
  channel.send(JSON.stringify({
    type: "response.create",
    response: { modalities: ["audio","text"], tool_choice: "none", conversation: "none" }
  }));
}

// ===== WebRTC =====
async function startRealtime() {
  console.clear();
  lastNif = null;
  dcMessageCount = 0;
  pdfTriggered = false;
  logUI("Start pulsado");

  // Pre-abrir pestaña para el PDF
  try {
    pdfWin = window.open("about:blank", "_blank", "noopener,noreferrer");
    if (pdfWin) {
      pdfWin.document.write("<!doctype html><title>Certificado</title><body style='font:14px system-ui;padding:20px'>Esperando certificado…</body>");
      logUI("Ventana PDF pre-abierta OK");
    } else {
      logUI("No se pudo pre-abrir la pestaña (¿pop-up bloqueado?).");
    }
  } catch (e) { logUI("Error pre-abriendo pestaña PDF: " + e.message); }

  setRtcStatus("Creando sesión...", true);
  const uiLang = $$("lang") ? $$("lang").value : "es";
  // 👉 Voz por defecto: 'coral' (más natural en castellano que 'alloy')
  const voice = $$("oaiVoice") ? ($$("oaiVoice").value || "cedar") : "cedar";
  const instructions = (uiLang === "eu") ? SAFE_PROMPT_EU : SAFE_PROMPT_ES;

  // Sesión
  const sessResp = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voice, instructions })
  });
  if (!sessResp.ok) {
    const txt = await sessResp.text(); setRtcStatus("Error sesión: " + txt, false); alert("Error /session: " + txt); return;
  }
  const sess = await sessResp.json();
  if (!sess?.client_secret?.value) { setRtcStatus("Falta client_secret en /session", false); alert("Falta client_secret en /session"); return; }
  logUI("Sesión creada OK");

  // RTCPeerConnection
  pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  pc.onicegatheringstatechange = () => logUI("iceGathering: " + pc.iceGatheringState);
  pc.oniceconnectionstatechange = () => logUI("iceConnection: " + pc.iceConnectionState);
  pc.onconnectionstatechange = () => logUI("pc.connectionState: " + pc.connectionState);

  pc.ondatachannel = (evt) => { logUI("DataChannel REMOTO: " + evt.channel.label); wireDc(evt.channel); };
  const localDc = pc.createDataChannel("oai-events"); logUI("DataChannel LOCAL: " + localDc.label); wireDc(localDc);

  // Audio local con cancelación de eco
  const ms = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  micTracks = ms.getAudioTracks();
  ms.getTracks().forEach(t => pc.addTrack(t, ms));

  // Audio remoto
  const audioEl = document.createElement("audio"); audioEl.autoplay = true;
  pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };

  // SDP
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  logUI("Enviando SDP offer a OpenAI");

  const baseUrl = "https://api.openai.com/v1/realtime";
  const sdpResp = await fetch(`${baseUrl}?model=${encodeURIComponent(sess.model || "gpt-4o-realtime-preview")}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${sess.client_secret.value}`,
      "Content-Type": "application/sdp",
      "OpenAI-Beta": "realtime=v1"
    },
    body: offer.sdp
  });
  logUI(`Respuesta SDP status=${sdpResp.status}`);
  if (!sdpResp.ok) { const txt = await sdpResp.text(); setRtcStatus("Error SDP: " + txt, false); alert("Error SDP: " + txt); return; }
  const answerSdp = await sdpResp.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  setRtcStatus("Conexión establecida.", true);
  logUI("Conexión WebRTC lista");
}

function wireDc(channel) {
  dc = channel;
  dc.onopen = () => {
    logUI("DataChannel OPEN: " + dc.label);
    const uiLang = $$("lang") ? $$("lang").value : "es";
    sendAssistantGreeting(dc, uiLang);
    setTimeout(() => { startLocalRecognition(uiLang); }, 2500);
  };
  dc.onclose = () => logUI("DataChannel CLOSE");
  dc.onerror = (e) => logUI("DataChannel ERROR: " + e.message);
  dc.onmessage = onDcMessage;
}

// Mute mientras habla el asistente; reactivar después si NO se disparó PDF
async function onDcMessage(event) {
  dcMessageCount++;
  let msg; try { msg = JSON.parse(event.data); } catch { return; }

  // Transcripción textual por depuración
  if (msg.type === "response.output_text.delta" && msg.delta) appendTranscript(msg.delta);
  if (msg.type === "response.audio_transcript.delta" && msg.delta) appendTranscript(msg.delta);
  if (msg.type === "response.audio_transcript.done" && msg.transcript) {
    appendTranscript("\n[agente] " + msg.transcript + "\n");
  }

  // Audio start/stop -> controlar micro y ASR local
  if (msg.type === "output_audio_buffer.started") {
    setMicEnabled(false);
    stopLocalRecognition();
  }
  if (msg.type === "output_audio_buffer.stopped") {
    setTimeout(() => {
      setMicEnabled(true);
      if (!pdfTriggered) startLocalRecognition(document.getElementById("lang")?.value || "es");
      else logUI("ASR no se reinicia: PDF ya disparado.");
    }, 200);
  }
}

$$("startBtn")?.addEventListener("click", startRealtime);
$$("stopBtn")?.addEventListener("click", () => {
  try { if (pc) pc.close(); } catch {}
  stopLocalRecognition();
  setMicEnabled(false);
  setRtcStatus("Conexión detenida.", true);
});
