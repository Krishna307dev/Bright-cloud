# Room Proguard rules
-keepclassmembers class * extends androidx.room.RoomDatabase {
    <init>();
}

# Firebase Proguard rules
-dontwarn com.google.firebase.**
