plugins {
    `java-library`
    `java-test-fixtures`
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

dependencies {
    // The loader-neutral core depends on the OpenTelemetry API only (NoLoaderImportsTest keeps loader imports out).
    implementation(libs.opentelemetry.api)

    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // NoLoaderImportsTest walks this tree.
    systemProperty("ledger.core.src", layout.projectDirectory.dir("src").asFile.absolutePath)
}