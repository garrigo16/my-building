' oficina-arranque.vbs - lanzador SOLO de la tarea "Canal IAs - oficina".
' Fija OFICINA_PORT=4391 en el entorno de este proceso y delega en oculto-node.vbs (sin tocarlo),
' que lo hereda y se lo pasa a node. Las demás tareas siguen usando oculto-node.vbs directamente.
' Antes, si la tarea hermana "Canal IAs - tunel Coo" existe y no está corriendo, la arranca (si ya corre, no se toca:
' reiniciar la oficina nunca corta un túnel sano; y si la arrancara de más, el supervisor ve su puerto cogido y sale solo).
' Uso: wscript.exe oficina-arranque.vbs "<ruta\server.js>"
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count < 1 Then WScript.Quit 2
On Error Resume Next
Set svc = CreateObject("Schedule.Service")
svc.Connect
Set tarea = svc.GetFolder("\").GetTask("Canal IAs - tunel Coo")
If Err.Number = 0 Then
  If tarea.State <> 4 Then tarea.Run ""   ' 4 = en ejecución
End If
Err.Clear
On Error GoTo 0
sh.Environment("PROCESS")("OFICINA_PORT") = "4391"
vbs = fs.BuildPath(fs.GetParentFolderName(WScript.ScriptFullName), "oculto-node.vbs")
rc = sh.Run("wscript.exe """ & vbs & """ """ & WScript.Arguments(0) & """", 0, True)
WScript.Quit rc
