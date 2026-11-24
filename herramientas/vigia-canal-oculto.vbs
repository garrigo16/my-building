' vigia-canal-oculto.vbs - lanza vigia-canal-timbre.sh con Git Bash SIN ventana. Lo usa la tarea programada
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
bash = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\Git\bin\bash.exe")
If Not fs.FileExists(bash) Then bash = sh.ExpandEnvironmentStrings("%ProgramFiles%\Git\bin\bash.exe")
script = fs.GetParentFolderName(WScript.ScriptFullName) & "\vigia-canal-timbre.sh"
sh.Run """" & bash & """ """ & script & """", 0, False
