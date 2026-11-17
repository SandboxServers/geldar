// Server-side NeoForge 26.1.2 mod. Pins: neoforge.version in gradle.properties, the ModDevGradle plugin below
// (net.neoforged.moddev 2.0.148, published 2026-09-29), and JUnit in gradle/libs.versions.toml.
// The mod adds no registry entries and no network payloads, so vanilla clients are not affected.
plugins {
    java
    id("net.neoforged.moddev") version "2.0.148"
}

version = "0.1.0"
group = "dev.geldar"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

neoForge {
    version = providers.gradleProperty("neoforge.version").get()

    runs {
        create("server") {
            server()
        }
    }

    mods {
        create("geldar_neoforge") {
            sourceSet(sourceSets.main.get())
        }
    }
}

dependencies {
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
}
