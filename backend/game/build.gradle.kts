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
    val fixturesDir = rootDir.resolve("../shared/game-fixtures").canonicalFile
    systemProperty("fixtures.dir", fixturesDir.path)
    // Declare the fixtures as inputs so editing them re-runs the tests.
    inputs.dir(fixturesDir).withPropertyName("fixtures").withPathSensitivity(PathSensitivity.RELATIVE)
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = false
    }
}
