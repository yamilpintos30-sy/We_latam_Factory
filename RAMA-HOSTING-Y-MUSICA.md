# Rama `hosting-y-musica` — brief para quien la trabaja

**15 de septiembre de 2026.** Esta rama existe para dos cosas, y nada más:

1. **Configurar el hosting** que vamos a usar (la web del proyecto y, más adelante,
   los servicios que corran detrás).
2. **Subir e integrar el módulo de generación de música** para los **videos en
   loop** que se publican en canales de música (lo-fi, relajante, ambiente).

Todo lo demás del repo (pipeline de video, prompts, alquiler de GPU) se toca
desde `main` y no desde acá. Cuando algo de esta rama esté listo, va por pull
request a `main`.

---

## 1 · Qué hay ya, y dónde

| qué | dónde | estado |
|---|---|---|
| El método entero, por formato | `MANUAL-DE-PRODUCCION.md` | leerlo primero; la sección **C** es la de los videos para música |
| El módulo de video (Python, importable) | `h3pipeline/` | funciona; `README.md` y `REGLAS.md` adentro |
| Los tres loops ya hechos | `mis-videos/lofi-lluvia/`, `lofi-koi/`, `lofi-orbita/` | sólo los JSON, notas y scripts están en el repo; los MP4 y PNG viven en la carpeta local |
| El máster del loop | `mis-videos/lofi-*/bucle.py` (mismo archivo en las tres) | funciona sin música y con una pista dada |
| La composición con ElevenLabs Music | `h3pipeline/musica.py` | funciona; pide una pista de duración exacta; **no es el módulo que va a hacer la música de los canales** |
| La página actual (Mesa de Armado) | `h3pipeline/web.py` → `h3pipeline/web/mesa.html` | HTML estático generado desde el módulo; hoy se abre en local |

Los medios no están en git a propósito (`.gitignore`): pesan 10 GB sin contar
los 196 GB de modelos. Si necesitás un MP4 o un PNG de referencia, pedilo.

---

## 2 · El módulo de música: el contrato

El video en loop se arma con `bucle.py`. Hoy recibe la música como **archivo**:

```
python -X utf8 -u bucle.py --musica <pista.mp3|wav> [--repite N] [--desde s] [--cruce s]
```

- Toma 5,0 s de cada clip, escala a 1080p, deja el ambiente de H3 a −18 dB
  debajo, cierra la música con un cruce de 2 s contra el audio que precede al
  segmento (así la vuelta del loop es continua), masteriza a −14 LUFS en dos
  pasadas, y saca un «loop ×3» para mirar el empalme.
- `--repite N` saca una versión de N vueltas con la música loopeada.

**Lo que el módulo de música tiene que entregar:** un archivo de audio (mp3 o
wav, 44,1 o 48 kHz, estéreo) de la duración que se le pida, o de duración libre
si la pista manda. Nada más. La integración es por archivo, no por API interna:
así el módulo puede vivir en otro repo, otro lenguaje u otro servidor.

**Lo que falta del lado del video** (se hace en `main`, no acá, pero afecta al
contrato):

- `bucle.py --largo-de-pista`: que la **pista mande la duración**. Repite el
  loop hasta cubrir la pista, corta al largo exacto y funde el último segundo.
- Soporte de **varios loops** que se alternan (tríos de 15 s, ver sección D del
  manual), para que una canción de 3 minutos no muestre el mismo loop doce
  veces.

Si el módulo de música puede devolver además **el tempo (BPM)** y **la
duración de un compás**, el cierre del loop se puede cortar en compás en vez de
en un punto arbitrario. Es opcional y mejora el empalme.

### Dónde ponerlo

- Código del módulo: `musica/` en la raíz del repo (carpeta nueva), con su
  propio `README.md`: cómo se instala, qué claves necesita (nunca en el repo:
  van en `.env`, que está ignorado), cómo se llama, qué devuelve.
- Si necesita modelos o pesos: **no van al repo**. Documentar de dónde se bajan
  y cuánto pesan, como hace `h3pipeline/remoto/setup.sh` con los de H3.
- Una prueba mínima: un comando que genere 60 s y deje el archivo en una ruta
  dada. Con eso se conecta a `bucle.py` en una línea.

---

## 3 · El hosting: lo que sabemos y lo que hay que decidir

Lo que hoy existe para servir es **una página estática** (`mesa.html`) que se
regenera desde Python cada vez que cambia el módulo. No hay backend. Lo que va
a hacer falta, en este orden:

1. **Servir la página** (y la web nueva que la va a reemplazar, también
   estática, generada desde `MANUAL-DE-PRODUCCION.md` y `h3pipeline/estructuras/`).
   Cualquier hosting estático sirve; lo que importa es que el deploy salga de
   un comando o de un push, para que la página nunca se edite a mano.
2. **Un lugar donde corra el módulo de música** si no corre en la máquina
   local: depende de lo que necesite (CPU, GPU, una API externa).
3. **Nada de GPU para video en el hosting**: el video se genera en máquinas
   alquiladas por hora en Vast.ai y se apaga al terminar (`h3pipeline/VAST.md`).

Restricciones conocidas de la máquina local, por si el hosting tiene que
convivir con ella: Avast rompe SSL en Python (hay un bundle de certificados en
`certs/`), ngrok está bloqueado por el antivirus, la red se corta.

**Entregable de esta parte:** un `HOSTING.md` en la raíz con la decisión, el
porqué, el costo mensual, cómo se despliega y cómo se revierte.

---

## 4 · Reglas de trabajo en el repo

- **`.env` nunca se sube.** Está en `.gitignore`. Las claves se pasan por
  variables de entorno o por un `.env.ejemplo` sin valores.
- **Medios nunca se suben** (mp4, wav, mp3, png, zip): también ignorados.
- Commits chicos, en español, diciendo qué cambia y por qué.
- Cuando una parte está lista: pull request a `main`, con el `README.md` o el
  `HOSTING.md` correspondiente actualizado en el mismo PR.
- Cualquier duda sobre el video, el prompt o la GPU: está en el manual o en
  `h3pipeline/VAST.md`; si no está ahí, preguntar antes de asumir.
