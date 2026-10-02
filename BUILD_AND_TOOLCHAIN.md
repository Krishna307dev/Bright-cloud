# Build and Toolchain

## SDK and Version Targets

- `compileSdk = 36` (Android 16)
- `targetSdk = 36` (Android 16)
- `minSdk = 24` (Android 7.0)
- Java Version: JDK 17 / JDK 21 (Language compatibility 17 with D8 desugaring)
- Kotlin Version: 2.0+

## Dependency Configuration

Uses Gradle Version Catalog (`gradle/libs.versions.toml`) and Kotlin DSL (`build.gradle.kts`).

### Firebase Dependencies (BoM `34.17.0`)
All Firebase dependencies use the main modules without deprecated `-ktx` suffixes:

```kotlin
dependencies {
    implementation(platform("com.google.firebase:firebase-bom:34.17.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-storage")
    implementation("com.google.firebase:firebase-firestore")
}
```

### AndroidX & Jetpack Dependencies
```kotlin
dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
}
```

### Testing Dependencies
```kotlin
testImplementation("junit:junit:4.13.2")
testImplementation("io.mockk:mockk:1.13.11")
testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
testImplementation("androidx.room:room-testing:2.6.1")
testImplementation("androidx.work:work-testing:2.9.1")
```

## Build Plugins

- `com.android.application` version `8.5.1`
- `org.jetbrains.kotlin.android` version `2.0.0`
- `com.google.devtools.ksp` version `2.0.0-1.0.21`
- `com.google.gms.google-services` version `4.4.2`

## Proguard / Release Configuration

Release builds must strip debug logs and include standard Room and Firebase rules:
- `-keepclassmembers class * extends androidx.room.RoomDatabase`
- `-dontwarn com.google.firebase.**`
