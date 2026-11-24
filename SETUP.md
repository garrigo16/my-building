# Instalación · Edificio de IAs

> Léelo con tu IA (Claude Code, Cursor o Codex) y pídele que haga los pasos contigo. Windows 10/11.
> Regla de oro: **cada persona con SU Slack, SUS tokens y SU repo de estado**. Nada de esto se comparte.

Hay dos niveles. Empieza por **A**; **B** solo cuando A funcione.

- **A · Canal git** (≈ 30 min): tus IAs se hablan por una rama `canal/<tu-usuario>/…` de `oca-salesforce`. Sin Slack.
- **B · Slack + oficina** (≈ 1-2 h): tu canal de Slack, la escucha que despierta a las IAs y la oficina local
  (http://127.0.0.1:4317) que te dice qué te toca.

## Antes de empezar

- Git for Windows (con Git Bash), Node.js LTS, la app de Claude (abre la pestaña Code una vez).
- Acceso a `oca-salesforce` en Bitbucket. Para B: poder crear una app en el Slack de OCA (puede pedir aprobación de un admin).
- Nunca pegues un token en un chat de IA, en Slack ni en git. Los secretos viven en `%USERPROFILE%\.config\` (ver `.env.example`).

## A · Canal git

1. **Instala** lo de arriba. Si vas a tocar orgs: Salesforce CLI (`sf`) con tus alias.
2. **Lee la biblia** de OCA: `git show origin/biblia-oca:AGENTS.md` (en el clon del paso 3) y
   `git show origin/biblia-oca:procedimientos/canal-ia/SETUP-CANAL-CLAUDE-CURSOR.md`.
3. **Clona el repo de OCA** en la ruta por defecto (o pon la tuya en `config.local.json`, `canalGit.repoLocal`):
   `git clone https://bitbucket.org/oca-global/oca-salesforce.git "%USERPROFILE%\Documents\Oca Global Repository\oca-salesforce"`
4. **Crea tu rama del canal y su worktree** (Git Bash, dentro del clon). La rama es tuya: nunca escribas en la de otro.
   ```bash
   git fetch origin
   # si tu rama no existe todavía, créala como dice SETUP-CANAL-CLAUDE-CURSOR.md; después:
   git fetch origin canal/<tu-usuario>/claude-cursor
   git worktree add --detach "$HOME/wt-canal-claude" origin/canal/<tu-usuario>/claude-cursor
   ```
   Prueba: `git ls-remote origin canal/<tu-usuario>/claude-cursor` devuelve una línea.

   **4a · Este repo y tu config mínima** (hace falta ya en A): clona este repo como dice el paso 5 y copia `config.ejemplo.json` a
   `config.local.json` con tu nombre y tu rama del canal (`canalGit.canales[0].rama`; el `fichero` es el que haya en tu rama). Sin eso,
   `publicar-canal.sh` y los `lanzar-*.sh` usan la rama de ejemplo. Los IDs de Slack se rellenan en B (paso 8).
   En A, `node herramientas/salud.js` marca ✘ lo que es de B (claves, tareas, oficina, escucha): es normal.

   **4b · Reiniciar la oficina y la escucha** (solo cuando ya tengas B, y después de cada `git pull` que cambie código). PowerShell:
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -match 'oficina\\server\.js|escucha-slack\.js' } | % { Stop-Process -Id $_.ProcessId -Force }; foreach ($t in 'Canal IAs - oficina','Canal IAs - escucha Slack') { schtasks /end /tn $t; schtasks /run /tn $t }
   ```

## B · Slack + oficina

5. **Este repo**, en la carpeta que quieras (se detecta sola; los ejemplos usan `.claude/relevo` en tu carpeta de usuario).
   - `origin` tiene que ser **un repo privado TUYO** (una copia de este). La oficina sube ahí tu turno, tu latido y lo que
     recuerda (rama `estado-oficina`: apuntes, privados ya vistos…). Si `origin` fuera el repo compartido, lo vería todo el mundo.
   - El repo compartido va como segundo remoto, `beta`, solo para traer mejoras y proponer las tuyas (ver `CONTRIBUIR.md`).
   ```bash
   git clone <URL del repo compartido> "$USERPROFILE/.claude/relevo" && cd "$USERPROFILE/.claude/relevo"
   git remote rename origin beta
   git remote add origin <URL de TU repo privado vacío> && git push -u origin main
   ```
6. **Tu app de Slack** (api.slack.com/apps → «Create New App», en el espacio de OCA) y tu canal (`#canal-<tu-usuario>`):
   - Socket Mode activado, con un token de app (`xapp-…`) → `SLACK_APP_TOKEN`.
   - Token de bot (`xoxb-…`) → `SLACK_BOT_TOKEN`. La oficina y los scripts usan: `conversations.history`,
     `conversations.replies`, `conversations.list`, `users.list` y `chat.postMessage`. Suscríbete a los eventos de mensajes del canal.
   - Invita al bot a tu canal. Apunta los IDs: el tuyo, el del canal y el de cada bot (Claude, Coo, Cursor si lo usas).
   - Opcional, para enviar con tu nombre desde la oficina: token de usuario (`xoxp-…`) en `oficina-slack.env`.
7. **Secretos**: crea `%USERPROFILE%\.config\canal-slack.env` siguiendo `.env.example` (y los otros ficheros si los usas).
   Deja todas las líneas aunque no uses esa pieza (Cursor, Coo/Grok, Jira, Bitbucket), con el valor vacío: `salud.js` y el instalador miran los nombres.
   `CLAUDE_CODE_OAUTH_TOKEN`: en Git Bash, `"$APPDATA/Claude/claude-code/"*/*/claude.exe setup-token`.
8. **Identidad**: copia `config.ejemplo.json` a `config.local.json` y rellénalo (tu nombre, IDs de Slack, tu rama del canal;
   y, si quieres, tus reglas de proyectos, tu equipo, tus coordinadores y Codex: ver `README.md`).
   Comprueba: `node herramientas/config.js` (dice qué sigue con el valor de ejemplo). No lleva secretos y no se sube (`.gitignore`).
9. **Instalador** (PowerShell, en la carpeta del repo): `.\instalar.ps1 -Equipo portatil`
   Revisa antes lo que hace (crea tres tareas programadas: escucha, oficina y vigía). Dice lo que falta.
10. **Comprueba**:
    - `node herramientas/salud.js` (solo lee; dice qué falta y qué hacer).
    - `node oficina/tests/todo.js` (≈ 5 min; Slack, Bitbucket y Jira falsos; nada sale del equipo).
    - http://127.0.0.1:4317 responde. Escribe en tu canal «@Claude hola»: debe contestarte en el hilo.
11. **Coo** (opcional): es una rutina de Grok que se despierta por webhook (`GROK_WEBHOOK_URL`, `GROK_WEBHOOK_KEY`). Su
    instrucción genérica está en `prompts/COO.md`. Sin Coo, Claude y Cursor funcionan igual.

## Dos equipos (casa y portátil)

Solo atiende Slack el equipo con el **turno**. Instala en los dos (mismo `origin` tuyo, distinto `-Equipo`) y cambia con
doble clic en «Atender desde aqui.cmd». Con un solo equipo no hace falta nada de esto.

## Qué no hacer

- No subas `config.local.json`, `*.env`, `estado-*.json` ni nada de `~/.oficina` o `~/.canal-logs`.
- No uses tokens, canal ni rama de otra persona. No escribas a personas desde un bot.
- No despliegues ni valides en Salesforce desde aquí: eso sigue las normas de OCA.

Cómo funciona por dentro: `COMO-FUNCIONA.md`. Cómo proponer mejoras: `CONTRIBUIR.md`.
