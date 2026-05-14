' ============================================================
'  arrancar-poe2-silencioso.vbs
'  Levanta backend y frontend sin abrir NINGUNA ventana.
'  Los procesos corren en segundo plano totalmente invisible.
'  Doble clic y listo. Usa parar-poe2.bat para detener.
' ============================================================

Dim oShell, sDir

Set oShell = CreateObject("WScript.Shell")

' Directorio donde está este script (raíz del proyecto)
sDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' Arranca el backend (0 = sin ventana, False = no esperar a que termine)
oShell.Run "cmd /c cd /d """ & sDir & "backend"" && node src/index.js", 0, False

' Pequeña pausa para que el backend esté listo antes del frontend
WScript.Sleep 2000

' Arranca el frontend
oShell.Run "cmd /c cd /d """ & sDir & "frontend"" && npm run dev", 0, False

' Opcional: abrir el navegador automáticamente tras 4 segundos
WScript.Sleep 4000
oShell.Run "explorer http://localhost:5173", 1, False

Set oShell = Nothing