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

repositories {
    // The test libraries come from Maven Central only. exclusiveContent keeps these groups off the other project
    // repositories, which ModDevGradle adds (the NeoForged maven among them), so the mirror never serves them.
    exclusiveContent {
        forRepository {
            mavenCentral()
        }
        filter {
            includeGroupAndSubgroups("org.junit")
            includeGroup("org.opentest4j")
            includeGroup("org.apiguardian")
        }
    }
}

dependencyLocking {
    lockAllConfigurations()
    // Lenient: locked versions stay pinned, but a dependency missing from the lock no longer fails; strict cannot work because Linux resolves netty epoll natives a Windows lockfile lacks (verification-metadata.xml sha256 is the integrity guard).
    lockMode = LockMode.LENIENT
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
