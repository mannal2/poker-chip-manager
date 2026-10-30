plugins {
    // Lets Gradle download the requested JDK toolchain automatically.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "poker-backend"

include("game")

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}
