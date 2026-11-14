@echo off
REM Double-clickable launcher for run.ps1 (bypasses the PowerShell script policy for this run only).
REM Arguments pass through, e.g.  run.cmd -Local -FakeModel
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
