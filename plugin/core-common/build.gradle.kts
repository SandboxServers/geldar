plugins {
    `java-library`
    `java-test-fixtures`
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

// Platform-neutral Geldar-Core code: nothing here imports Bukkit, Paper, CoreProtect, BlueMap or any other server API.
// The Paper adapter (core) depends on it, and so will a later NeoForge adapter. It is not published on its own: core's
// jar packs it, as it packs jnats.
dependencies {
    compileOnly(libs.gson)
    implementation(libs.jnats)

    testImplementation(libs.gson)
    testImplementation(libs.json.schema.validator)
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)

    // Test helpers shared with the Paper adapter's tests (src/testFixtures). Same libraries as the tests.
    testFixturesImplementation(libs.gson)
    testFixturesImplementation(libs.jnats)
    testFixturesImplementation(libs.json.schema.validator)
    testFixturesImplementation(libs.junit.jupiter)
}

tasks.test {
    useJUnitPlatform()
    // The tests validate envelopes against the shared contract schemas.
    systemProperty("geldar.schemas", rootProject.layout.projectDirectory.dir("../contract/schemas").asFile.absolutePath)
}
