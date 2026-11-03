plugins {
    `java-library`
}

// The rules module has no runtime dependencies (JDK only); test libraries and the JSON mapping stay test-scoped.
dependencies {
    testImplementation(platform("org.junit:junit-bom:5.13.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation("org.assertj:assertj-core:3.27.4")
    testImplementation(project(":game-json"))
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
