package com.archos.mediacenter.video.utils;

import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.os.Build;

/** CharmIPTV implementation of the three callbacks used by the pinned AVOS JNI. */
public final class CodecDiscovery {
    private static boolean software(MediaCodecInfo codec) {
        return Build.VERSION.SDK_INT >= 29 ? codec.isSoftwareOnly() :
            codec.getName().startsWith("OMX.google.") || codec.getName().startsWith("c2.android.");
    }
    public static boolean isCodecTypeSupported(String mime, boolean allowSoftware) {
        try {
            for (MediaCodecInfo c : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos())
                if (!c.isEncoder() && (allowSoftware || !software(c)))
                    for (String type : c.getSupportedTypes()) if (type.equalsIgnoreCase(mime)) return true;
        } catch (RuntimeException ignored) {}
        return false;
    }
    public static String getCodecForProfile(String mime, int profile) {
        try {
            for (MediaCodecInfo c : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
                if (c.isEncoder() || software(c)) continue;
                for (String type : c.getSupportedTypes()) if (type.equalsIgnoreCase(mime))
                    for (MediaCodecInfo.CodecProfileLevel level : c.getCapabilitiesForType(type).profileLevels)
                        if (level.profile == profile) return c.getName();
            }
        } catch (RuntimeException ignored) {}
        return null;
    }
    public static int getDoViMode() { return 0; } // Automatic, never force an unsupported HDR mode.
}
