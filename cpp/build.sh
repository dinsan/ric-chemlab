#!/usr/bin/env bash
# Builds the fluid core into cpp/build/ (no CMake required).
set -e
cd "$(dirname "$0")"
mkdir -p build
case "$(uname -s)" in
  Darwin) OUT=libfluid.dylib ;;
  MINGW*|MSYS*|CYGWIN*) OUT=fluid.dll ;;
  *) OUT=libfluid.so ;;
esac
g++ -O3 -std=c++17 -shared -fPIC -Iinclude src/fluid.cpp -o "build/$OUT"
echo "Built cpp/build/$OUT"
