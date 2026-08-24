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
