@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%RDE_NODE%" "%RDE_CLI%" %*
