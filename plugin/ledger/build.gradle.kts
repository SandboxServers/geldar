plugins {
    `java-library`
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

val sparkApiJar = file("libs/spark-api-0.1-20260912.112908-2.jar")

dependencies {
    compileOnly(libs.paper.api)
    // Paper provides gson; the stats-file reader parses with it.
    compileOnly(libs.gson)
    // BlueMap provides its API at runtime; compile-only, never bundled.
    compileOnly(libs.bluemap.api) {
        isTransitive = false
    }
    // spark provides its API at runtime when installed (soft dependency); compile-only, never bundled.
    // Vendored jar (MIT, see libs/README.md): the upstream snapshot is purged on each publish; VendoredSparkApiTest pins its sha256.
    compileOnly(files(sparkApiJar))
    implementation(project(":ledger-core"))
    implementation(libs.opentelemetry.api)

    testImplementation(libs.paper.api)
    testImplementation(libs.gson)
    testImplementation(files(sparkApiJar))
    testImplementation(testFixtures(project(":ledger-core")))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // CensusHookTest reads this build script.
    systemProperty("ledger.build.script", file("build.gradle.kts").absolutePath)
    inputs.file("build.gradle.kts")
}

tasks.processResources {
    filesMatching("plugin.yml") {
        expand("version" to project.version)
    }
}

// The server has neither the core module nor the OpenTelemetry API, so the plugin jar carries both. Paper supplies the rest.
tasks.jar {
    archiveBaseName = "ledger"
    archiveVersion = ""
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    // The jar packs runtimeClasspath, which includes :ledger-core's jar: build it first.
    dependsOn(configurations.runtimeClasspath)
    from({
        configurations.runtimeClasspath.get().filter { it.name.endsWith(".jar") }.map { zipTree(it) }
    }) {
        exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "META-INF/MANIFEST.MF", "module-info.class")
    }
}

// A later card adds census.gradle.kts here without editing this file.
if (file("census.gradle.kts").exists()) apply(from = "census.gradle.kts")
