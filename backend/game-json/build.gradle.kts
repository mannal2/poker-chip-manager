plugins {
    `java-library`
}

// Maps the Java game model to the TS-named JSON of the shared fixtures; the server reuses it.
dependencies {
    api(project(":game"))
    api(platform("tools.jackson:jackson-bom:3.1.7"))
    api("tools.jackson.core:jackson-databind")

    testImplementation(platform("org.junit:junit-bom:5.13.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation("org.assertj:assertj-core:3.27.4")
}

tasks.test {
    useJUnitPlatform()
    // The shared event cases live outside the backend tree.
    val fixturesDir = rootDir.resolve("../shared/game-fixtures").canonicalFile
    systemProperty("fixtures.dir", fixturesDir.path)
    inputs.dir(fixturesDir).withPropertyName("fixtures").withPathSensitivity(PathSensitivity.RELATIVE)
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = false
    }
}
