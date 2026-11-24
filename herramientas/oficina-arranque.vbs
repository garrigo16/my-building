' oficina-arranque.vbs - lanzador SOLO de la tarea "Canal IAs - oficina".
' Fija OFICINA_PORT=4391 en el entorno de este proceso y delega en oculto-node.vbs (sin tocarlo),
' que lo hereda y se lo pasa a node. Las demás tareas siguen usando oculto-node.vbs directamente.
' Uso: wscript.exe oficina-arranque.vbs "<ruta\server.js>"
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count < 1 Then WScript.Quit 2
sh.Environment("PROCESS")("OFICINA_PORT") = "4391"
vbs = fs.BuildPath(fs.GetParentFolderName(WScript.ScriptFullName), "oculto-node.vbs")
rc = sh.Run("wscript.exe """ & vbs & """ """ & WScript.Arguments(0) & """", 0, True)
WScript.Quit rc
