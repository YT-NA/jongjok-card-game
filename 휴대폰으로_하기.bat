@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo ==================================================
echo   엉뚱 한마당 - 휴대폰으로 하기
echo --------------------------------------------------
echo   1. 휴대폰을 이 PC와 같은 와이파이에 연결하세요.
echo   2. 휴대폰 인터넷 창(크롬/사파리)에 아래 주소를 입력하세요.
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  set ip=%%a
  set ip=!ip: =!
  echo        http://!ip!:8766
)
echo.
echo   * 처음 실행할 때 "방화벽" 창이 뜨면 [허용]을 눌러주세요.
echo   * 이 검은 창을 닫으면 휴대폰 접속이 끊깁니다.
echo ==================================================
python -m http.server 8766
pause
