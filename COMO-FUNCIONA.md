# Cómo funciona el Edificio de IAs (1 página)

**Qué es**: varias IAs que trabajan para una persona («Humano» en todo el código; tu nombre va en `config.local.json`) y se coordinan solas. Humano habla en **Slack** (#canal-humano, un hilo por
tema); entre ellas hablan por el **canal git** (tu rama `canal/<usuario>/claude-cursor` del repo de OCA; opcionalmente un segundo canal compartido de proyecto). La
**oficina** (http://127.0.0.1:4317) le enseña qué le toca y quién trabaja.

## Quién es quién
- **Claude**: lo despierta la escucha. Trabaja en el repo de OCA, lee orgs y escribe en ellos solo con el OK de Humano.
- **Coo** (rutina de Grok): coordina, prepara correos y chats, y lleva la decisión a Humano. Se despierta por webhook (`avisar-coo.sh`).
- **Cursor** (agente en la nube): revisa y cruza en git. Se despierta por su API (`lanzar-cursor.sh`, `atender-cursor-slack.sh`).
- **Grok**: tercera lectura. **Charla** y **Gus**: traen temas de Google Chat y del correo.

## Las piezas (en el equipo que tiene el turno)
| Pieza | Qué hace | Dónde |
|---|---|---|
| Escucha | Oye Slack. Si Humano nombra a Claude, o una IA deja `[lo hace: X]`, despierta a X. | `herramientas/escucha-slack.js` (tarea «escucha Slack») |
| Oficina | Lee Slack, logs, procesos, Cursor, Jira y el canal git. Dice el estado de cada tema. Con turno, también envía. | `oficina/server.js` (tarea «oficina») |
| Vigía | Cada 15 min. L-V de 8 a 20 despierta a la IA a la que un bloque del canal pide algo (y otra vez si no contesta); a cualquier hora, comprueba que la oficina contesta. | `herramientas/vigia-canal-timbre.sh` → `canal-pendientes.js`, `vigila-oficina.js` |
| Timbre | Una línea en un hilo fijo de Slack por cada bloque publicado; «decisión tuya» si hace falta Humano. | `herramientas/timbre.sh` |

Se vigilan entre ellas: el vigía comprueba cada 15 min (a cualquier hora) que la oficina contesta y, si no, la levanta; la oficina avisa si el vigía deja de pasar, levanta la escucha si se para y relanza lo que no arrancó; la escucha se reconecta sola al despertar el PC o si Slack deja de renovarle la conexión.

Avisos que pide hacer algo (arriba en la oficina): Claude sin token, escucha desconectada, nadie con el turno vivo, este equipo sin poder subir al repo, el vigía parado, el canal git atascado, una respuesta para ti que no llegó a Slack y un Claude colgado. Cada uno dice qué hacer.

## El contrato (lo que leen la oficina, la escucha y el vigía)
- **En Slack**, la última línea de cada mensaje de una IA lleva una de estas etiquetas:
  - `[te toca: ¿pregunta?]`: necesita algo de Humano.
  - `[lo hace: Claude|Cursor|Coo — qué]`: el siguiente paso es de esa IA, que se despierta sola.
  - `[hecho]`: no queda nada pendiente.
- **En el canal git**, lo mismo, en la cabecera del bloque: `<!-- para: … | id: … | estado: lo hace: Cursor — qué -->`.
- La pauta completa está en `herramientas/formato-para-humano.txt`. Un solo lector entiende los bloques: `herramientas/canal-bloques.js`.

## Qué significa cada estado en la oficina
- **Te toca**: una pregunta o decisión para Humano, con sus opciones como botones (el botón manda el texto exacto a la IA que lo hace).
- **En marcha**: una IA trabaja ahora en ese tema.
- **Esperando**: el siguiente paso es de una IA, o de una persona de fuera.
- **Parado**: nadie lo ha cogido a tiempo. Antes de decirlo, la oficina relanza una vez a la IA que no arrancó.
- **Cerrado**: hecho, relevado o enviado.

Cada tema lleva desde cuándo dura (`temaDesde`), siguiendo los relevos («Viene de:») y Jira.

## Casa y portátil
Solo atiende el equipo con el **turno**. Para cambiarlo: «Atender desde aqui.cmd». Así:
- La escucha se pasa al otro equipo en menos de 1 minuto.
- La oficina del equipo sin turno queda en solo lectura.
- Lo que recuerda la oficina (pausas, notas, Jira ya visto) viaja con el turno, por la rama `estado-oficina` (solo se sube
  cuando cambia algo).
- El equipo con el turno «late» cada 10 min (`refs/latido/…` en el repo). Si deja de latir 30 min (apagado, sin red), la oficina del otro equipo avisa: nadie atiende Slack.

Instalar o poner al día un equipo: `SETUP.md`.

## Si algo va mal
- **¿Está todo bien en este equipo?** `node herramientas/salud.js`: repasa turno, código, claves (solo nombres), tareas, oficina, escucha, vigía y traspasos, y dice qué hacer (✔/⚠/✘). Solo lee.
- **¿Sale algo raro en la oficina?** `node oficina/pruebas/en-vivo.js <título>`: su estado con los datos reales, sin tocar nada.
  Y `node oficina/tests/repaso-dia.js 08:00 20:00 [título] [--dia AAAA-MM-DD]`: cómo se vio cada tema a lo largo de un día.
- **Antes de cambiar código**: `node oficina/tests/todo.js` (≈ 3 min: los scripts, contra
  un Slack/Bitbucket/Jira falso; nada sale del equipo). Añade el caso nuevo en `oficina/pruebas/`.
- **El vigía, en seco**: `VIGIA_CANAL_ESTADO=<copia> bash herramientas/vigia-canal-timbre.sh --seco`.
- **Logs**, en `~/.canal-logs`:
  - `escucha-slack.log`: lo que oye la escucha.
  - `sesiones-slack.log`: cada Claude lanzado desde Slack.
  - `traspasos.log`: a quién despertó o relanzó el vigía, y los relanzos de la oficina.
  - `vigia-canal.log`: lo que hace el vigía (y si tuvo que levantar la oficina).
  - `avisar-coo.log`: los avisos a Coo.
  - `cursor-arranques.log`: los arranques de Cursor.
  - `oficina-envios.log`: lo que hace la oficina (si levantó la escucha, y cuánto tardó en arrancar).
  - `slack-no-enviado.log`: respuestas de Claude que no llegaron a Slack.
- **Reiniciar**: el comando del paso 4b de `SETUP.md` (cierra el node y vuelve a lanzar la tarea; `schtasks /end` solo no lo cierra). La oficina tarda unos 25 s en tener datos.
- **Reglas que no cambian**: ninguna IA escribe a una persona desde su bot. En los orgs, nada sin el OK de Humano. Las IAs hablan entre ellas por el canal git.
