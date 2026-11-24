# Prompts de las IAs (versión genérica)

«Humano» es la palabra fija con la que el sistema nombra a la persona para la que trabajan las IAs. Su nombre de verdad
está en `config.local.json` (`persona.nombre`) y los scripts se lo dicen a cada IA al despertarla.

| IA | Dónde vive su prompt | Quién la despierta |
|---|---|---|
| Claude | Dentro de `herramientas/atender-slack.sh` (Slack) y `herramientas/lanzar-claude.sh` (canal git). Resumen: `CLAUDE.md`. | La escucha de Slack y el vigía |
| Cursor | Dentro de `herramientas/atender-cursor-slack.sh` y `herramientas/lanzar-cursor.sh`. Resumen: `CURSOR.md`. | Su API (`CURSOR_API_KEY`) |
| Codex | Dentro de `herramientas/lanzar-codex.sh` (canal git; solo con `codex.activo` en la config). | El vigía y `publicar-canal.sh` |
| Coo | En su rutina de Grok (fuera del repo). Pega `COO.md` como instrucción. | Webhook (`herramientas/avisar-coo.sh`) |

La pauta de formato que comparten las tres: `herramientas/formato-para-humano.txt`. El contrato de etiquetas: `COMO-FUNCIONA.md`.
