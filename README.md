# Edificio de IAs (beta)

Varias IAs (Claude, Cursor y un coordinador, «Coo») que trabajan para una persona y se coordinan solas: se hablan por un
**canal git**, la persona les habla por **Slack** y una **oficina** local le enseña qué le toca decidir.

Este repo es la copia **limpia y genérica**: sin historial anterior, sin datos de nadie. En todo el código la persona se
llama «Humano»; quién es de verdad va en `config.local.json`, que no se sube.

| Quieres… | Lee |
|---|---|
| Montarlo en tu equipo | `PARA-MIQUEL-Y-DANI.md` y `SETUP.md` |
| Entender cómo funciona | `COMO-FUNCIONA.md` |
| Proponer una mejora | `CONTRIBUIR.md` |

## Qué hay

| Carpeta | Qué es |
|---|---|
| `herramientas/` | El canal git y Slack: escucha, vigía, freno, timbre, `atender-*`, `lanzar-*`, `publicar-canal.sh`, turno, salud, `config.js`. |
| `prompts/` | Los prompts de Coo, Claude y Cursor en versión genérica (y dónde vive cada uno). |
| `oficina/` | El panel local (http://127.0.0.1:4317): `server.js`, `public/index.html` y sus pruebas (`pruebas/`, `tests/`). |
| raíz | `SETUP.md`, `instalar.ps1`, `config.ejemplo.json`, `.env.example`, los dos `.cmd`. |

La oficina va en su carpeta (`oficina/`) y cada persona corre la suya, con sus tokens y sus IAs. Nadie ve la de otro.

## Actualizar

Cada oficina mira sola (cada 3 minutos) si hay algo nuevo en el repo común (remoto `beta`) y lo dice en una línea discreta:

- **🍳 Update en cocina**: alguien está cocinando una mejora (una rama o una PR abierta en el repo común, o una IA trabajando en tu equipo).
- **⬆ Versión nueva lista: vNNN (qué trae)**, con dos botones: **Actualizar ahora** y **Más tarde** (no insiste en 3 horas).
- **⬆ Actualizando a vNNN…** y, al acabar, **✔ Estrenada la vNNN**.

Por defecto el modo es `"actualizar": "manual"`: no se trae nada hasta que pulses. Con `"auto"` en tu `config.local.json` se
actualiza sola. El estreno es **en caliente**: la oficina nueva arranca al lado y la de antes le pasa el puerto; la página no se
cae. Si la versión nueva no arranca, se queda la de antes y lo avisa. Detalle: `oficina/update.js`.

A mano también vale: `git fetch beta && git merge --ff-only beta/main` y reiniciar (`SETUP.md`, paso 4b).

## Configuración

- **Identidad** (no es secreta, pero es tuya): `config.local.json`, copia de `config.ejemplo.json`. La lee `herramientas/config.js`
  (Node) y `herramientas/config.sh` (Bash). `node herramientas/config.js` enseña qué vale y qué sigue de ejemplo.
- **Secretos**: `%USERPROFILE%\.config\*.env`, según `.env.example`. Nunca en git.
- Sin `config.local.json` valen los valores de ejemplo (IDs de mentira): así corren las pruebas.

Lo que ya sale de la config: tu ID de Slack, los de tus bots, el canal de Slack (ID y nombre), el espacio de Slack, la rama y
el fichero de tu canal git, el segundo canal (opcional), el repo local y remoto, el repo de Bitbucket y el sitio de Jira.
Tu nombre: se lo dicen los scripts a Claude y a Cursor al despertarlos, la página lo enseña en lugar de «Humano»
(`oficina/public/persona.js`), «@<tu nombre>» vale como «@humano» y sale en la copia de tus privados al hilo.

**Por qué «Humano»**: el código, las etiquetas (`[te toca: …]`) y los bloques del canal usan una palabra fija para la persona.
Así el mismo código y las mismas pruebas valen para todos; el nombre de verdad se pone al enseñarlo.

## Informe del escaneo de secretos y datos personales (20/11/2026)

Hecho sobre todos los ficheros del repo, antes del primer commit.

| Qué se buscó | Resultado | Nota |
|---|---|---|
| IDs de Slack (`U0…`, `C0…`, `D0…`, `W0…`, `B0…`) | **0** | Los de las pruebas son de mentira y no empiezan por `U0`/`C0` (`UHUMANO0001`, `CCANAL00001`…). |
| Tokens (`xox…`, `xapp-…`) con forma real | **0** | Quedan unas 50 cadenas `xox`/`xapp-` de mentira en pruebas y comentarios (`xoxb-falso`, `xapp-prueba`, `xoxp-`…): justificado. |
| Webhooks de Slack, claves de API | **0** | |
| Correos de la empresa o de Gmail | **0** | |
| Otros correos | unos 30, todos de mentira | `…@ejemplo.invalid`, `…@cliente.invalid`, `…@emp.test`; y `noreply@anthropic.com` (firma de commit): justificado. |
| Los 11 nombres propios de la lista del encargo | **0** en código y pruebas | Solo salen en `PARA-MIQUEL-Y-DANI.md` (la guía va dirigida a ellos y nombra al dueño del repo) y donde se cita ese fichero: justificado. Quedan falsos positivos de subcadena («publicarla», «arrancarla»). |
| Rutas personales (`C:\Users\<usuario>`) | **0** | Quedan `C:\Users\x` y `C:\Users\u` (rutas de mentira en dos pruebas y un comentario). |
| Claves de Jira reales | **0** | Quedan claves inventadas de ejemplo (`ABC-123`) e identificadores de bloques del canal. |
| Nombres de clientes, de compañeros (también los inventados que los sustituían) y de otros proyectos | **0** | |

### Qué se quitó o se cambió respecto al repo original

- Fuera: el historial de git entero, los diarios y resúmenes, el diario de cambios de la oficina y las guías personales.
- Fuera: **los comentarios que contaban casos** (unos 2.900: los que llevaban fechas, horas, citas o nombres) en el código, la
  página y los scripts. Los comentarios que explican el código sin contar un caso se quedan.
- Fuera: **las pruebas hechas con conversaciones de trabajo** (unos 70 ficheros). Quedan las pruebas técnicas (scripts, arranque,
  escucha, vigía, consumo…) y una plantilla con un caso inventado (`oficina/pruebas/ejemplo-tema.js`).
- Fuera: las reglas de proyectos y temas, la lista de personas, los coordinadores y los colores de proyecto que venían de
  ejemplo. Todo eso sale ahora vacío y se rellena en `config.local.json`.
- Cambiado: la persona → «Humano»; IDs de Slack → de mentira; correos → dominios `.invalid`. En los textos para las IAs
  (pauta de formato, prompts) los ejemplos son genéricos («la persona A», «un tema de facturación»).
- Se queda a propósito: «OCA», `oca-salesforce`, el espacio de Slack y el sitio de Jira de OCA como valores por defecto, y el
  convenio de títulos de PR de OCA. Son de la empresa, no de una persona. Todos se cambian en la config o en el script.
- «Coo», «Charla», «Gus» y «Grok» son nombres de papeles de IA, no de personas.

## Pruebas

`node oficina/tests/todo.js` → **77 bien, 0 mal** (30 ficheros) (≈ 5 min). Con un `config.local.json` puesto da lo mismo: las
pruebas no leen la config del equipo.

Las pruebas con casos completos de la oficina (varios cientos) **no están aquí**: se hicieron con conversaciones de trabajo y
viven solo en el repo privado del dueño, que las pasa al revisar cada PR. Aquí, cada mejora trae su caso nuevo con datos
inventados (`ejemplo-tema.js` es la plantilla).

Probado en vivo, en modo demo (carpeta de usuario y config de mentira, sin tokens, puertos de prueba): la oficina pinta vacía y
enseña el nombre y el canal de la config; ve una rama del repo común como «update en cocina»; con una versión nueva en
`beta/main` saca «Versión nueva lista» con sus botones y, al pulsar «Actualizar ahora», la estrena en caliente (ninguna
petición sin contestar durante el cambio). No se ha probado contra un Slack de verdad, ni la escucha.

## Qué más sale de la config

| Clave de `config.local.json` | Para qué | Si no la pones |
|---|---|---|
| `oficina.proyectos`, `oficina.temas` | Reglas que agrupan hilos por proyecto y por tema: `["Nombre", "expresión", "i"]`. | Ninguna regla: cada hilo es su tema, proyecto «General». |
| `oficina.visitantes` | Nombres de tu equipo que la página enseña «de visita». | Nadie. |
| `oficina.appId` | El ID de tu app de Slack (para distinguir lo que envía la oficina). | Un ID de ejemplo. |
| `coordinadores` | Coordinadores de Claude Code, si los usas: `{ "id": "coord-x", "nombre": "X", "proyecto": "x", "titulo": "expr", "carpetas": "expr" }`. | Ninguno: el módulo no lee nada ni pasa temas a nadie. |
| `canalGit.canales[1]` | Un segundo canal (su nombre lo eliges tú; su worktree es `~/wt-<nombre>-claude`). | Solo el principal. |
| `codex` | `{ "activo": true, "modelo": "" }`: Codex pasa a ser una IA del canal y lo despierta `herramientas/lanzar-codex.sh`. | Codex no se lanza solo. |

La carpeta del repo se detecta sola: puede estar donde quieras.

**Modo demo**, para mirar la oficina sin instalar nada y sin tocar las tareas del equipo:
`OFICINA_DEMO=1 OFICINA_PORT=4399 node oficina/server.js` (sin tokens pinta vacío y avisa de que falta el de Slack).
En demo no arranca ni para la escucha, no usa las tareas programadas y los estrenos van sin el relanzador de reserva.
`salud.js` mira el puerto de `OFICINA_PORT` (por defecto 4317).

**Interruptor de Cursor**: crea el fichero vacío `herramientas/cursor-apagado` y nada llama a la API de Cursor ni a los webhooks de
las rutinas de Coo y Grok (`lanzar-cursor.sh`, `atender-cursor-slack.sh`, `avisar-coo.sh`, `lanzar-grok.sh`, `atender-grok.sh`): ese
trabajo pasa a Claude. Se reactiva borrando el fichero. Es de cada equipo (está en `.gitignore`). No frena lo que arranca fuera de
tu equipo: los horarios propios de las rutinas o mencionar a Cursor/Coo a mano en Slack. Prueba: `oficina/pruebas/cursor-apagado.js`.

## TODO (lo que queda y hay que saber)

| Fichero | Línea | Qué |
|---|---|---|
| `herramientas/lanzar-codex.sh` | todo | Probado con un Codex de mentira. Con el CLI de verdad, repasar las opciones de `codex exec` la primera vez. Codex no tiene lanzador desde Slack (solo desde el canal git). |
| `oficina/public/persona.js` | todo | Probado en navegador con la oficina vacía (nombre, canal, títulos y textos nuevos cambian; las cajas de texto no). Sin probar con hilos de verdad. |
| `oficina/server.js` | `ORGS_NOMBRE` | Nombres de orgs genéricos (UAT, QA…), fijos. |
| `oficina/coordinadores.js` | principio | Las palabras que marcan «esto es de Salesforce» son fijas. Solo actúan si configuras un coordinador `coord-salesforce`. |
| `herramientas/atender-slack.sh` | 264 | Alias de orgs `sf` de OCA en el prompt de Claude. |
| `herramientas/avisar-coo.sh`, `abrir-pr.sh` | 46, 34 | Convenio de títulos de PR de OCA y sus prefijos de línea, fijos. |
| `instalar.ps1` | 17 | Pide Salesforce CLI aunque no la uses. |
| `prompts/COO.md` | todo | Versión genérica escrita a partir del contrato, no la rutina original. Sin probar. |
