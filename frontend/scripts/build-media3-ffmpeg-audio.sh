#!/usr/bin/env bash
#
# Builds the LGPL-only audio subset of the official AndroidX Media3 FFmpeg
# extension for the Android TV APK. This deliberately does NOT enable GPL
# components. Review Dolby/DTS patent obligations before distributing builds.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE="$ROOT/android/ffmpeg-audio/src/main"
FFMPEG_DIR="$MODULE/jni/ffmpeg"
FFMPEG_COMMIT="ea3d24bbe3c58b171e55fe2151fc7ffaca3ab3d2" # upstream n6.0
ANDROID_API="${CHARM_FFMPEG_ANDROID_API:-26}"
NDK_PATH="${ANDROID_NDK_HOME:-${ANDROID_HOME:-}/ndk/27.1.12297006}"
HOST_PLATFORM="linux-x86_64"
case "$(uname -s)" in
  Darwin*) HOST_PLATFORM="darwin-x86_64" ;;
  MINGW*|MSYS*|CYGWIN*) HOST_PLATFORM="windows-x86_64" ;;
esac

if [[ ! -d "$NDK_PATH" ]]; then
  echo "Android NDK not found: $NDK_PATH" >&2
  echo "Install ndk;27.1.12297006 or set ANDROID_NDK_HOME." >&2
  exit 1
fi

if [[ ! -d "$FFMPEG_DIR/.git" ]]; then
  if [[ -e "$FFMPEG_DIR" ]]; then
    echo "Refusing to overwrite an unrecognized FFmpeg source directory: $FFMPEG_DIR" >&2
    exit 1
  fi
  git clone --depth 1 --branch n6.0 https://github.com/FFmpeg/FFmpeg.git "$FFMPEG_DIR"
fi
if [[ "$(git -C "$FFMPEG_DIR" rev-parse HEAD)" != "$FFMPEG_COMMIT" ]]; then
  echo "FFmpeg source does not match pinned n6.0 commit $FFMPEG_COMMIT" >&2
  exit 1
fi

# Keep this list deliberately narrow: common IPTV/Dolby/DTS audio plus
# widespread fallback formats. FFmpeg's default LGPL build is retained by
# never passing --enable-gpl or linking external GPL libraries.
DECODERS=(
  aac ac3 eac3 dca truehd mlp
  mp3 opus vorbis flac alac
  amrnb amrwb pcm_mulaw pcm_alaw
)

BUILD_KEY="$FFMPEG_COMMIT|$ANDROID_API|$HOST_PLATFORM|${DECODERS[*]}|$(cat "$NDK_PATH/source.properties")|$(git hash-object "$MODULE/jni/build_ffmpeg.sh")"
COMPLETE=true
for abi in armeabi-v7a arm64-v8a x86 x86_64; do
  for lib in avcodec avutil swresample; do
    [[ -s "$FFMPEG_DIR/android-libs/$abi/lib$lib.a" ]] || COMPLETE=false
  done
done
if [[ "$COMPLETE" == true && -f "$FFMPEG_DIR/.charm-audio-build" && "$(cat "$FFMPEG_DIR/.charm-audio-build")" == "$BUILD_KEY" ]]; then
  echo "Media3 FFmpeg audio libraries already built."
  exit 0
fi

"$MODULE/jni/build_ffmpeg.sh" \
  "$MODULE" \
  "$NDK_PATH" \
  "$HOST_PLATFORM" \
  "$ANDROID_API" \
  "${DECODERS[@]}"

printf '%s\n' "$BUILD_KEY" > "$FFMPEG_DIR/.charm-audio-build"
