# Nocturne — AI Music Studio

Estudio para detectar tendencias con Ollama Cloud y producir demos, singles y álbumes originales con Eleven Music v2 y portadas locales.

## Ejecutar

1. Copia `.env.example` como `.env`.
2. Añade claves **nuevas** de Ollama y ElevenLabs (la Music API requiere un plan de pago).
3. Instala el modelo visual local: `bash scripts/setup-cover-model.sh` (descarga varios GB).
4. Ejecuta `npm start` y abre `http://localhost:3000`. Desde Tailscale usa `http://<IP-TAILSCALE>:3000`.

### Acceso desde el mismo Wi-Fi usando WSL2

Abre PowerShell como Administrador en Windows y ejecuta `enable-wifi-access.ps1`. El script crea un portproxy hacia WSL y una regla TCP 3000 limitada a dispositivos de la subred local. Muestra la URL LAN al terminar. Para retirarlo, ejecuta `disable-wifi-access.ps1` como Administrador.

No hay dependencias externas de npm. Sin claves, la interfaz funciona en modo demo y no incurre en costes.

## Cómo funciona

- **Short:** 15–90 segundos.
- **Video:** 1–10 minutos.
- **Long:** 60–180 minutos, dividido en partes de hasta 10 minutos por el límite de la API.
- Ollama Web Search recupera señales actuales y Ollama Cloud las convierte en un concepto y prompt original.
- Primero genera una demo de 30 segundos y tres portadas para elegir. Solo después de aprobar música y portada se produce el lote completo.
- El usuario elige entre 1 y 30 singles/videos de un mismo universo creativo.
- Se generan dos canciones simultáneamente por defecto; el límite se controla con `GENERATION_CONCURRENCY`.
- ElevenLabs genera masters PCM que se encapsulan como WAV estéreo de 48 kHz / 16-bit.
- `stabilityai/sd-turbo` genera portadas en CPU y las entrega ampliadas a 3000×3000 PNG.
- El ZIP final contiene WAV, portada de cada single y metadatos JSON/CSV listos para cargar en un distribuidor.
- Cada trabajo se persiste en `data/jobs/`: la biblioteca recupera sesiones terminadas o en curso después de recargar la web.
- Si el servicio se reinicia durante una generación, conserva los archivos ya terminados y marca el trabajo como interrumpido para evitar cobros duplicados.
- Las claves solo viven en el servidor. Los audios se guardan en `data/generated/` y están ignorados por Git.
- Al seleccionar una canción puede combinarse con `data/templates/music-video-template.mp4`. El audio original se sustituye y el vídeo se recorta o repite para que el MP4 tenga exactamente la duración de la canción completa.
- El prompt de sistema y cada solicitud enviada al motor exigen que la música sea audible desde el segundo 1, sin silencio inicial ni una introducción ambiental vacía.

El producto evita pedir imitaciones de artistas o canciones concretas. “NightFall Melodies” se usa únicamente como referencia general de formato editorial nocturno/ambiental. Spotify no permite subir lanzamientos musicales directamente desde esta aplicación: el ZIP se entrega a un distribuidor aprobado por Spotify, que asigna ISRC/UPC y tramita la publicación.
