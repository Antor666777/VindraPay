-keepattributes Signature, InnerClasses, EnclosingMethod, *Annotation*

-keep class com.vindrapay.monitor.data.remote.** { *; }

-dontwarn org.codehaus.mojo.animal_sniffer.IgnoreJRERequirement
-dontwarn javax.annotation.**

-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.vindrapay.monitor.**$$serializer { *; }
-keepclassmembers class com.vindrapay.monitor.** { *** Companion; }
-keepclasseswithmembers class com.vindrapay.monitor.** { kotlinx.serialization.KSerializer serializer(...); }

-keep class androidx.security.crypto.** { *; }

-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.jsse.**
-dontwarn org.openjsse.**

# Please add these rules to your existing keep rules in order to suppress warnings.
# This is generated automatically by the Android Gradle plugin.
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.CheckReturnValue
-dontwarn com.google.errorprone.annotations.Immutable
-dontwarn com.google.errorprone.annotations.RestrictedApi
