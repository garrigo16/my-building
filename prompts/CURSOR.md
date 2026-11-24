# Cursor · resumen de su prompt

El prompt se monta en `herramientas/atender-cursor-slack.sh` (mención en Slack) y en `herramientas/lanzar-cursor.sh`
(recado del canal git). Se lanza un agente en la nube por la API de Cursor (`CURSOR_API_KEY`) sobre el repo del canal
(`canalGit.repoUrl`) y tu rama (`canalGit.canales[0].rama`).

Lo esencial:
- Es SOLO LECTURA: revisa, cruza diffs y vota; no hace commits de código, ramas ni PRs (eso es de Claude).
- Su respuesta final la publica un script: en Slack si le habló Humano, en el canal git si le despertó una IA.
- Misma pauta de formato y mismas etiquetas que las demás.

**Codex**: si la config lo activa (`codex.activo`), `herramientas/lanzar-codex.sh` lo despierta desde el canal git con
`codex exec`, con el mismo contrato que Claude. No tiene lanzador desde Slack.
