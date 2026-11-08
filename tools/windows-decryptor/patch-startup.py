from pathlib import Path
p=Path('windows-decryptor-build/main_windows.go')
s=p.read_text(encoding='utf-8')
if '\t"os"\n' not in s:
    s=s.replace('import (\n', 'import (\n\t"os"\n',1)
# CreateFontW is exported by GDI32, not USER32. The earlier executable
# panicked on startup before a window appeared because the DLL was wrong.
wrong='createFont                                                                                = dllUser.NewProc("CreateFontW")'
correct='createFont                                                                                = dllGdi.NewProc("CreateFontW")'
if s.count(wrong)!=1: raise SystemExit('Expected exactly one CreateFontW USER32 binding')
s=s.replace(wrong,correct,1)
probe='dllKernel                                                                                 = syscall.NewLazyDLL("kernel32.dll")'
if s.count(probe)!=1: raise SystemExit('Expected one kernel32 DLL binding')
s=s.replace(probe,probe+'\n\tdllGdi                                                                                    = syscall.NewLazyDLL("gdi32.dll")',1)
marker='func main() {\n'
replacement='''func main() {
	defer func() {
		if recovered := recover(); recovered != nil {
			if len(os.Args) > 1 && os.Args[1] == "--smoke-test" {
				_ = os.WriteFile("gui-startup-smoke-error.txt", []byte(fmt.Sprintf("GUI panic: %v", recovered)), 0600)
				os.Exit(2)
			}
			messageBox.Call(0, u(fmt.Sprintf("The Windows interface could not start.\\r\\n\\r\\n%v", recovered)), u("Charming MediaLab - Startup Error"), MB_OK|MB_ICONERROR)
			os.Exit(1)
		}
	}()
'''
if s.count(marker)!=1: raise SystemExit('main() signature missing or ambiguous')
s=s.replace(marker,replacement,1)
marker2='\tupdateWnd.Call(hwndMain)\n\tvar msg winMsg'
replacement2='''	updateWnd.Call(hwndMain)
	// GitHub Actions runs this same executable in a real Windows process,
	// verifying creation of the main window, the controls and the message loop.
	if len(os.Args) > 1 && os.Args[1] == "--smoke-test" {
		if hwndMain == 0 || hwndZIP == 0 || hwndKey == 0 || hwndFormat == 0 || hwndOutput == 0 || hwndPassword == 0 || hwndConfirm == 0 || hwndDecrypt == 0 || hwndProtect == 0 || hwndStatus == 0 {
			os.Exit(3)
		}
		postMsg.Call(hwndMain, WM_CLOSE, 0, 0)
	}
	var msg winMsg'''
if s.count(marker2)!=1: raise SystemExit('UI startup marker missing or ambiguous')
s=s.replace(marker2,replacement2,1)
p.write_text(s,encoding='utf-8')
