# Para Miquel y Dani · el Edificio de IAs en vuestro equipo

Es la forma de trabajar de Juanjo: varias IAs (Claude, Cursor/Codex y un coordinador, «Coo») que se reparten el trabajo
por un canal git y os preguntan solo lo que tenéis que decidir vosotros. Esto es una **beta**: os va a fallar algo; decidlo.

**Cada uno lo monta en SU equipo, con SU Slack, SUS tokens y SU repo privado.** Nadie ve la oficina, los privados ni los
apuntes de otro. En el código la persona se llama siempre «Humano»: vuestro nombre va en un fichero local que no se sube.

## 1. Qué os lleváis

| Nivel | Qué es | Tiempo |
|---|---|---|
| **A · Canal git** | Vuestras IAs se hablan por vuestra rama `canal/<usuario>/…` de `oca-salesforce`. Sin Slack. | ≈ 30 min |
| **B · Slack + oficina** | Vuestro canal de Slack, la escucha que despierta a las IAs y la oficina local que dice «te toca». | ≈ 1-2 h |

Empezad por A. Pasad a B cuando A os funcione un par de días.

Para A ya hace falta este repo (punto 2) y un `config.local.json` con vuestro nombre y vuestra rama del canal (`SETUP.md`, paso 4a):
sin él los scripts publican en la rama de ejemplo. Tokens y Slack, solo en B.

- **Dani**: ya tienes `canal/dcorteso/claude-cursor`.
- **Miquel**: ya tienes `canal/miquel/claude-codex-cursor`. Para que Codex se despierte solo cuando un bloque del canal le pide
  algo, pon `"codex": { "activo": true }` en tu `config.local.json` (`herramientas/lanzar-codex.sh`). Está sin estrenar con un
  Codex de verdad: eres el primero en probarlo.

## 2. Bajarlo

1. Juanjo os da acceso al repo compartido (`https://github.com/JuanjoAvila/Edificio-de-IAs-beta.git`, privado).
2. Cread en vuestra cuenta de GitHub un repo **privado y vacío** (p. ej. `mi-edificio`). Ese será vuestro `origin`: ahí sube la
   oficina vuestro turno y lo que recuerda. No lo compartáis.
3. En Git Bash:
   ```bash
   git clone https://github.com/JuanjoAvila/Edificio-de-IAs-beta.git "$USERPROFILE/.claude/relevo" && cd "$USERPROFILE/.claude/relevo"
   git remote rename origin beta
   git remote add origin <URL de vuestro repo privado> && git push -u origin main
   ```

## 3. Que lo configure vuestra IA (prompt listo para pegar)

Abrid Claude Code (o Cursor/Codex) **en la carpeta del repo** y pegad esto, cambiando la primera línea:

```
Soy <TU NOMBRE>, mi usuario para el canal es <tu-usuario> y uso <Claude + Cursor | Claude + Codex + Cursor>.
Quiero montar el Edificio de IAs en este equipo. Nivel: <A | A y B>.

Lee, en este orden: PARA-MIQUEL-Y-DANI.md, SETUP.md, COMO-FUNCIONA.md, .env.example, config.ejemplo.json y prompts/README.md.
Después guíame paso a paso por SETUP.md. Reglas:

1. Haz tú todo lo que puedas (comprobar lo instalado, clonar, crear el worktree, copiar config.ejemplo.json a
   config.local.json y rellenarlo con lo que yo te diga, pasar las comprobaciones). Un paso cada vez, y dime qué has hecho.
2. NUNCA me pidas que te pegue un token, una contraseña o un webhook en el chat. Cuando haga falta un secreto, dime en
   qué fichero de %USERPROFILE%\.config\ va y con qué nombre de variable, y lo escribo yo. No leas ni muestres esos ficheros:
   comprueba solo que existen y los NOMBRES de sus variables.
3. No ejecutes instalar.ps1 sin enseñarme antes qué tareas programadas crea y esperar mi «ok».
4. No hagas push a ningún sitio sin mi «ok». Mi origin es mi repo privado; el remoto «beta» es el compartido y solo se
   toca con una rama mejora/… y una PR (CONTRIBUIR.md).
5. No escribas en la rama del canal de otra persona, ni en Slack, ni en ningún org de Salesforce.
6. Al acabar cada nivel, pasa: node herramientas/config.js, node herramientas/salud.js y (nivel B) node oficina/tests/todo.js.
   Enséñame el resultado y dime, en llano, qué falta. En el nivel A es normal que salud.js marque ✘ lo que es de B
   (claves, tareas programadas, oficina y escucha): no lo arregles todavía.
7. Si algo de la guía no cuadra con lo que ves en el equipo, para y dímelo: apúntalo, que es justo lo que hay que mejorar.
```

Lo que tendréis que hacer vosotros a mano (la IA os dirá cuándo): crear la app de Slack y el canal, escribir los tokens en
`%USERPROFILE%\.config\canal-slack.env`, y dar los «ok».

## 4. Prueba de humo
- **A**: pedid a vuestra IA que publique un bloque de prueba en vuestro canal y que otra lo lea. Se ve en el worktree del canal
  (`git -C ~/wt-canal-claude fetch origin && git -C ~/wt-canal-claude log origin/canal/<usuario>/… -1`): ahí `origin` es `oca-salesforce`;
  en la carpeta de este repo `origin` es vuestro repo privado, no el canal. A mano y sin Slack:
  `bash herramientas/publicar-canal.sh principal bloque.md "prueba [skip ci]"`, con un `bloque.md` que empiece por `<!-- para: Claude | id: prueba -->`.
  Si dice «NO publicado: hay commits que no has leído», es lo esperado cuando otro ha escrito antes: leedlos y relanzad el mismo comando.
- **B**: `node herramientas/salud.js` sin ✘; http://127.0.0.1:4317 abre; escribís «@Claude hola» en vuestro canal y contesta en el hilo.
- **Solo mirar la oficina, sin instalar nada ni tokens** (Git Bash): `OFICINA_DEMO=1 OFICINA_PORT=4399 node oficina/server.js` y abrid
  http://127.0.0.1:4399. Sale vacía y avisa de que falta el token de Slack: es lo esperado.

## 5. Proponer mejoras (ramas y PR)

```bash
git fetch beta && git checkout main && git merge --ff-only beta/main     # ponerse al día
git checkout -b mejora/<tu-usuario>-<tema>                               # una rama por mejora
# … cambios + su prueba en oficina/pruebas/ …
node oficina/tests/todo.js                                               # en verde
git push beta mejora/<tu-usuario>-<tema>                                 # y abrir la PR a main en el repo compartido
```

- **Con vuestra IA**: en `CONTRIBUIR.md` hay un prompt listo para pegar que hace todo esto y os enseña el diff antes de subir nada.
- Juanjo revisa la PR (puede pedir cambios en la misma rama) y la mezcla. Nada de push directo a `main`.
- **Antes de cada PR, el escaneo de `CONTRIBUIR.md` tiene que dar 0**: ni tokens, ni IDs de Slack, ni correos, ni nombres
  de compañeros o clientes, ni vuestro `config.local.json`.
- Un fallo o una idea sin código: issue en el repo compartido, o en `#ai-enjoyers`.
- Para traer las mejoras de otros: el botón «Actualizar ahora» de la oficina (punto 6).

## 6. Actualizaciones: cómo se ven y cómo se ponen

Vuestra oficina mira sola el repo compartido cada 3 minutos y os lo cuenta en una línea, arriba, sin molestar:

| Lo que veis | Qué significa | Qué hacéis |
|---|---|---|
| 🍳 Update en cocina: rama … de … | Alguien está preparando una mejora (una rama o una PR abierta en el repo compartido). | Nada. Es para que lo sepáis. |
| ⬆ Versión nueva lista: v… (qué trae) | Juanjo ha mezclado una mejora en `main`. | **Actualizar ahora**, o **Más tarde** (no insiste en 3 horas). |
| ⬆ Actualizando a v… | Se está trayendo y estrenando. | Esperar unos segundos. La página no se cae. |
| ✔ Estrenada la v… | Ya está. | Nada. |

- Nunca se actualiza sola: elegís vosotros cuándo. Si preferís que lo haga sola, poned `"actualizar": "auto"` en `config.local.json`.
- Si la versión nueva no arranca, sigue la de antes y os lo dice. No perdéis nada.
- Después de actualizar, si queréis tener vuestra copia al día en vuestro repo: `git push origin main`.

## 7. Lo que NO hay que hacer

- Usar tokens, canal de Slack o rama de otro. Compartir vuestro repo de estado (`origin`).
- Subir `config.local.json`, `*.env` o cualquier cosa de `~/.oficina` y `~/.canal-logs`.
- Dejar que una IA escriba a una persona desde un bot, o que toque un org sin vuestro OK.

**Cursor gasta cuota de la cuenta del equipo** (también las rutinas de Coo y Grok). Para pararlo en vuestro equipo sin tocar claves:
cread el fichero vacío `herramientas/cursor-apagado`. Mientras exista, nada llama a Cursor, Coo ni Grok y ese trabajo lo hace Claude.
Se reactiva borrándolo. No se sube a git. No frena lo que lancéis a mano en Slack ni los horarios propios de las rutinas.

## 8. Qué sabemos que cojea

Está en el `README.md` («TODO»). Lo principal: el lanzador de Codex y el prompt de Coo están sin estrenar, y nada de esto se ha probado todavía
contra un Slack de verdad fuera del equipo de Juanjo: lo estrenáis vosotros.
