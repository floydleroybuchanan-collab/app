-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.** { *; }
-keep class expo.modules.** { *; }
-dontwarn com.facebook.hermes.**
-keepattributes *Annotation*

# Remove verbose/info Android logging from optimized release and RC sideload
# bytecode without changing warning/error reporting used for support.
-assumenosideeffects class android.util.Log {
  public static int v(...);
  public static int d(...);
  public static int i(...);
}

# Optional desktop-Java adapters bundled by Rhino and dnsjava. Android does
# not provide java.beans or the legacy Sun JVM name-service SPI, and CharmIPTV
# never invokes those desktop-only integration paths.
-dontwarn java.beans.**
-dontwarn sun.net.spi.nameservice.**

# Keep Parcelable implementations
-keepclassmembers class * implements android.os.Parcelable {
  public static final android.os.Parcelable$Creator CREATOR;
}
