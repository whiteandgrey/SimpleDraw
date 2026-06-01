!include "MUI2.nsh"

Name "SimpleDraw"
OutFile "/home/wwwwg/simpledraw/simpledraw-desktop/release/SimpleDraw-1.5.6-win32-x64-installer.exe"
InstallDir "$PROGRAMFILES64\SimpleDraw"
RequestExecutionLevel admin

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

VIProductVersion "1.5.6.0"
VIAddVersionKey "ProductName" "SimpleDraw"
VIAddVersionKey "CompanyName" "SimpleDraw Team"
VIAddVersionKey "LegalCopyright" "© 2026 SimpleDraw Team"
VIAddVersionKey "FileDescription" "SimpleDraw - Vector Drawing Tool"
VIAddVersionKey "FileVersion" "1.5.6.0"

Section "Install"
    SetOutPath "$INSTDIR"
    File /r "/home/wwwwg/simpledraw/simpledraw-desktop/release/SimpleDraw-win32-x64\*.*"

    SetShellVarContext all
    CreateDirectory "$SMPROGRAMS\SimpleDraw"
    CreateShortCut "$SMPROGRAMS\SimpleDraw\SimpleDraw.lnk" "$INSTDIR\SimpleDraw.exe"
    CreateShortCut "$DESKTOP\SimpleDraw.lnk" "$INSTDIR\SimpleDraw.exe"

    WriteUninstaller "$INSTDIR\uninstall.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleDraw" "DisplayName" "SimpleDraw"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleDraw" "UninstallString" "$INSTDIR\uninstall.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleDraw" "DisplayVersion" "1.5.6"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleDraw" "Publisher" "SimpleDraw Team"
SectionEnd

Section "Uninstall"
    SetShellVarContext all
    RMDir /r "$INSTDIR"
    RMDir /r "$SMPROGRAMS\SimpleDraw"
    Delete "$DESKTOP\SimpleDraw.lnk"
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleDraw"
SectionEnd
