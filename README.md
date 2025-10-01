# IVR Realtime + SOAP + TTS (Vercel)

Frontend (`/public`) servido estático. Backend como **Vercel Serverless Functions** en `/api`.

## Variables de entorno (Vercel → Settings → Environment Variables)
- `OPENAI_API_KEY` (obligatorio)
- `REALTIME_MODEL` (opcional, p. ej. `gpt-4o-realtime-preview`)
- **TTS (elige una)**:
  - `GOOGLE_APPLICATION_CREDENTIALS_JSON` con el contenido del JSON del service account (recomendado en Vercel)
  - o `GOOGLE_APPLICATION_CREDENTIALS` con la ruta local al JSON (solo para desarrollo local)

## Desarrollo local
```bash
npm i -g vercel
npm i
cp .env.example .env
# Rellena claves en .env
vercel dev
```

## Deploy
- Sube este repo a GitHub → Importar en Vercel → Deploy.
- O desde CLI: `vercel` y luego `vercel --prod`.

## Endpoints
- `GET /` (sirve `public/index.html`)
- `POST /api/session` inicia sesión para Realtime (usa `OPENAI_API_KEY`)
- `POST /api/certificado` obtiene datos del certificado (SOAP)
- `GET|POST /api/certificado/pdf` devuelve el PDF (binary)
- `POST /api/tts` sintetiza audio (Google TTS)