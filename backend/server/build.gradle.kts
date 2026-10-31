version = "0.1.0-SNAPSHOT"

plugins {
    java
    id("org.springframework.boot") version "4.1.2"
    id("io.spring.dependency-management") version "1.1.7"
}

// Exposes META-INF/build-info.properties so the health endpoint can report the build version.
springBoot {
    buildInfo()
}

dependencies {
    implementation(project(":game-json"))
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-websocket")

    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.springframework.boot:spring-boot-starter-security-test")
    testImplementation("com.tngtech.archunit:archunit-junit5:1.5.1")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
    // API examples live outside the backend tree; declared as inputs so editing them re-runs the tests.
    val contractDir = rootDir.resolve("../shared/api-contract").canonicalFile
    systemProperty("contract.dir", contractDir.path)
    // Tests move the clock themselves, so the background sweep must not race them.
    systemProperty("poker.sweep.enabled", "false")
    inputs.dir(contractDir).withPropertyName("apiContract").withPathSensitivity(PathSensitivity.RELATIVE)
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = false
    }
}
