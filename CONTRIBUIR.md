# Cómo proponer mejoras

El repo compartido es el remoto `beta` (ver `SETUP.md`, paso 5). Tu `origin` es tu repo privado: ahí no entra nadie más.

## El camino

1. Ponte al día: `git fetch beta && git checkout main && git merge --ff-only beta/main`.
2. Rama nueva desde `main`: `git checkout -b mejora/<tu-usuario>-<tema-corto>`.
3. Haz el cambio. Si tocas `oficina/` o `herramientas/`, añade su caso en `oficina/pruebas/` y pasa `node oficina/tests/todo.js`.
4. Pasa el escaneo de datos personales (abajo). Tiene que dar 0.
5. `git push beta mejora/<tu-usuario>-<tema-corto>` y abre la **PR a `main`** en el repo compartido.
   Título claro; en la descripción, en español: qué cambia, por qué y cómo lo probaste.
6. `main` solo se mezcla con el OK del dueño del repo. Nada de push directo a `main` ni de `--force` en ramas de otros.

## Reglas

1. **Sin secretos ni datos de nadie** en commits, ramas, PR ni comentarios: tokens, webhooks, `.env`, `config.local.json`,
   correos, IDs de Slack reales, nombres de compañeros o clientes, claves de Jira reales, rutas de tu usuario.
2. **Nada de identidad fija en el código**: lo que dependa de quién eres va a `config.local.json` (`herramientas/config.js`).
   En el código y en las pruebas la persona es siempre «Humano», con los IDs de ejemplo.
3. Las pruebas y los comentarios usan SIEMPRE ejemplos inventados («un tema de facturación», «la persona A»). Nunca copies un
   mensaje, un caso ni una conversación de trabajo, aunque cambies los nombres. Plantilla: `oficina/pruebas/ejemplo-tema.js`.
4. Las mejoras a las normas de OCA van como PR a `biblia-oca` (Bitbucket), no aquí.
5. Si tocas el arranque de las IAs, documenta también Codex.

## Escaneo antes de cada PR (Git Bash, en la raíz del repo)

```bash
grep -rIEn --exclude-dir=.git '\b[UCDWBT]0[A-Z0-9]{8,10}\b' . | grep -v 'README.md'                       # IDs de Slack
grep -rIEn --exclude-dir=.git 'xox[abprs]-[A-Za-z0-9]{10}|xapp-[0-9]|hooks\.slack\.com/services/T' .      # tokens de verdad
grep -rIEin --exclude-dir=.git '@[o]ca|@[g]mail|C:\\Users\\[a-z]{3,}' . | grep -v 'README.md\|CONTRIBUIR.md' # correos y rutas
```

Los tres tienen que salir vacíos. Añade tu nombre y los de tu equipo a la búsqueda antes de subir.

## Qué pasa con tu PR después

Si se acepta, entra en la beta tal cual. Para llevarla también a la oficina de origen se revisa aparte: se copian solo los ficheros
de código y pruebas de tu PR, sin config, datos ni logs. Por eso conviene que sea pequeña, de un solo tema y con su prueba.

## Con tu IA (prompt listo para pegar)

Abre tu IA en la carpeta del repo y pega esto, cambiando la primera línea:

```
Quiero proponer esta mejora al Edificio de IAs: <qué y por qué, en dos frases>.

Lee CONTRIBUIR.md y síguelo al pie de la letra:
1. Ponte al día con beta/main y crea la rama mejora/<mi-usuario>-<tema>. No trabajes en main.
2. Haz el cambio más pequeño que lo resuelva. Nada de identidad fija: lo que dependa de quién soy va a config.local.json
   (herramientas/config.js). En código y pruebas la persona es «Humano», con los IDs de ejemplo.
3. Añade o ajusta su caso en oficina/pruebas/ con datos de mentira y pasa node oficina/tests/todo.js. Tiene que quedar en verde.
4. Pasa los tres comandos del escaneo. Tienen que salir vacíos. Busca también mi nombre y los de mi equipo.
5. Enséñame el diff y un resumen en llano. NO hagas commit ni push sin mi «ok».
6. Con mi «ok»: commit, git push beta <rama> y dame el título y la descripción de la PR (qué cambia, por qué, cómo se probó).
   La PR la abro yo. No toques main ni ramas de otros, y no subas nada a mi origin que no sea mío.
```

## Revisión

- Revisa y mezcla el dueño del repo, con sus IAs. Puede pedir cambios en la PR: se arreglan en la misma rama.
- Pasa además su batería privada de casos de la oficina (no está en este repo).
- Qué mira: que las pruebas pasan, que el escaneo da 0, que no hay identidad fija y que el cambio sirve a todos, no solo a uno.
- Una vez mezclada, cada uno la trae a su equipo cuando quiera (botón «Actualizar ahora» de la oficina; ver «Actualizar» en el `README.md`).
