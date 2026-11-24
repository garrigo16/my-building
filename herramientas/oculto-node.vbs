' oculto-node.vbs - arranca un script de Node SIN ventana. Lo usan las tareas "Canal IAs - oficina" y
' Uso: wscript.exe oculto-node.vbs "<ruta\script.js>"
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count < 1 Then WScript.Quit 2
js = WScript.Arguments(0)
node = sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
If Not fs.FileExists(node) Then node = "node.exe"
sh.CurrentDirectory = fs.GetParentFolderName(js)
rc = sh.Run("""" & node & """ """ & js & """", 0, True)
WScript.Quit rc
