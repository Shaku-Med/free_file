; People updating from the old Electron app get it removed first, so they don't
; end up with two Memories apps, and so its uninstaller never runs after this
; one and deletes the new Memories.lnk shortcuts (they share the name).
; The key is the GUID electron-builder derives from com.brozy.memories.
!define ELECTRON_APP_KEY "Software\28a0895e-d4fd-50d7-8891-e4d9fa2d8053"

Var ElectronDir
Var ElectronExit

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $ElectronDir HKCU "${ELECTRON_APP_KEY}" "InstallLocation"
  ${If} $ElectronDir != ""
  ${AndIf} ${FileExists} "$ElectronDir\Uninstall Memories.exe"
    DetailPrint "Removing the previous version of ${PRODUCTNAME}"
    ; _?= keeps the uninstaller in place so ExecWait really waits for it.
    ExecWait '"$ElectronDir\Uninstall Memories.exe" /currentuser /S _?=$ElectronDir' $ElectronExit
    ${If} $ElectronExit = 0
      Delete "$ElectronDir\Uninstall Memories.exe"
      RMDir "$ElectronDir"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; The Electron updater runs this installer with only /S and has already quit,
  ; so start the new app for them. Our own updater passes /R, handled by Tauri.
  ${If} ${Silent}
    ClearErrors
    ${GetOptions} $CMDLINE "/R" $ElectronExit
    ${If} ${Errors}
      nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
    ${EndIf}
  ${EndIf}
!macroend
