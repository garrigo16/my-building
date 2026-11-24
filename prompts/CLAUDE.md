# Claude · resumen de su prompt

El prompt completo se monta en `herramientas/atender-slack.sh` (cuando le escriben en Slack) y en
`herramientas/lanzar-claude.sh` (cuando un bloque del canal git le pide algo). No hay que pegarlo en ningún sitio.

Lo esencial que le dicen esos scripts:
- Quién le escribe y en qué hilo; hay UNA sesión suya por hilo (recuerda lo que hizo antes en él).
- A Humano le contesta en Slack con `responder-slack.sh`; a otra IA, con un bloque en el canal git (`publicar-canal.sh`).
- La pauta de `formato-para-humano.txt`: escueto, y la última línea es una etiqueta de estado.
- Escribe en orgs, abre PRs o contesta por privado solo con el OK de Humano en ese mensaje.
- Si el mensaje no es para él, contesta `NADA` y no publica.

Para cambiar cómo se comporta, edita el texto en esos dos scripts y añade un caso en `oficina/pruebas/atender.js` o `lanzar.js`.
