@echo off
cd /d "C:\Users\Utilisateur\Desktop\siteobfusque"
git add -A
set /p msg="Message du commit : "
git commit -m "%msg%"
git push
echo.
echo ✅ Push done!
pause