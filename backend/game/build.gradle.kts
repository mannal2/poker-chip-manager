plugins {
    `java-library`
}

// The rules module has no runtime dependencies (JDK only); test libraries stay test-scoped.
dependencies {
    testImplementation(platform("org.junit:junit-bom:5.13.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation("org.assertj:assertj-core:3.27.4")
    testImplementation("com.fasterxml.jackson.core:jackson-databind:2.20.0")
}

tasks.test {
    useJUnitPlatform()
    // Shared rule cases live outside the backend tree.
    systemProperty("fixtures.dir", rootDir.resolve("../shared/game-fixtures").canonicalPath)
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = false
    }
}
