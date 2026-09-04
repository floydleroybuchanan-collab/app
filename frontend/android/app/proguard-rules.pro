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

# Keep Parcelable implementations
-keepclassmembers class * implements android.os.Parcelable {
  public static final android.os.Parcelable$Creator CREATOR;
}
